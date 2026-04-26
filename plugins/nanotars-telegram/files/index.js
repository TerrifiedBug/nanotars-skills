import { Bot, InputFile } from 'grammy';
import { sanitizeTelegramLegacyMarkdown } from './markdown-sanitize.js';

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Telegram caption max length (sendPhoto/Video/Audio/Document share this cap).
const TELEGRAM_CAPTION_MAX = 1024;

// File-extension → Telegram API method mapping for inline-rendered media.
// Without this, every file goes via sendDocument and renders as a download
// attachment. Detecting by extension lets us dispatch to sendPhoto / sendVideo
// / sendAudio so the user sees inline previews instead.
const MEDIA_EXTENSIONS = {
  '.png': 'photo',
  '.jpg': 'photo',
  '.jpeg': 'photo',
  '.gif': 'photo',
  '.webp': 'photo',
  '.mp4': 'video',
  '.mov': 'video',
  '.webm': 'video',
  '.mkv': 'video',
  '.mp3': 'audio',
  '.ogg': 'audio',
  '.wav': 'audio',
  '.m4a': 'audio',
  '.opus': 'audio',
};

function detectMediaKind(filename, mime) {
  // Prefer extension since Telegram is filename-driven for previews.
  if (filename) {
    const idx = filename.lastIndexOf('.');
    if (idx !== -1) {
      const kind = MEDIA_EXTENSIONS[filename.slice(idx).toLowerCase()];
      if (kind) return kind;
    }
  }
  // Fall back to mime prefix when extension is missing/unknown.
  if (typeof mime === 'string') {
    if (mime.startsWith('image/')) return 'photo';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
  }
  return null;
}

function clipCaption(caption) {
  if (!caption) return undefined;
  return caption.length > TELEGRAM_CAPTION_MAX
    ? caption.slice(0, TELEGRAM_CAPTION_MAX)
    : caption;
}

// Retry a one-shot operation that can fail on transient network errors at
// cold-start (DNS hiccups, brief upstream outages — common when the host
// service launches before the network is fully up). Exponential backoff
// capped at 5 attempts; after that we surface the error so the service
// crashes loudly instead of hanging silently.
async function withRetry(fn, label, logger, maxAttempts = 5) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      const delay = Math.min(16000, 1000 * 2 ** (attempt - 1));
      logger.warn(
        { label, attempt, delayMs: delay, err: err.message || err },
        'Telegram setup failed, retrying',
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// Sentence/paragraph-aware splitter (ported from nanoclaw v2's splitForLimit).
// Prefers paragraph (\n\n), then line (\n), then word (space) boundaries; only
// falls back to a hard slice when none is found within the limit.
function splitForLimit(text, limit) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n\n', limit);
    if (cut <= 0) cut = remaining.lastIndexOf('\n', limit);
    if (cut <= 0) cut = remaining.lastIndexOf(' ', limit);
    if (cut <= 0) cut = limit;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

class TelegramChannel {
  name = 'telegram';

  /** @private */
  bot = null;
  /** @private */
  config;
  /** @private */
  logger;
  /** @private - swarm bot pool, loaded dynamically from pool.js if present */
  pool = null;

  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  async connect() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN not set');
    }

    this.bot = new Bot(token);
    const triggerPattern = new RegExp(
      '^@' + escapeRegex(this.config.assistantName) + '\\b',
      'i',
    );

    // Command to get chat ID (useful for registration)
    this.bot.command('chatid', (ctx) => {
      const chatId = ctx.chat.id;
      const chatType = ctx.chat.type;
      const chatName =
        chatType === 'private'
          ? ctx.from?.first_name || 'Private'
          : ctx.chat.title || 'Unknown';

      ctx.reply(
        `Chat ID: \`tg:${chatId}\`\nName: ${chatName}\nType: ${chatType}`,
        { parse_mode: 'Markdown' },
      );
    });

    // Command to check bot status
    this.bot.command('ping', (ctx) => {
      ctx.reply(`${this.config.assistantName} is online.`);
    });

    this.bot.on('message:text', async (ctx) => {
      // Skip commands
      if (ctx.message.text.startsWith('/')) return;

      // Cross-channel pairing-codes intercept (host primitive — see
      // nanotars src/pending-codes.ts and the /pair-telegram admin
      // command). When the inbound text is exactly 4 digits (or
      // `@<botname> 1234` for groups with privacy ON), try to consume
      // the code BEFORE delivering to the agent. On match, the chat
      // becomes claimed — we send a confirmation and short-circuit.
      // Mirrors v2 src/channels/telegram.ts:212-295.
      if (typeof this.config.consumePendingCode === 'function') {
        const rawText = ctx.message.text;
        const botUsername = ctx.me?.username;
        let candidate = rawText.trim();
        if (botUsername) {
          const mentionRe = new RegExp(
            '^@' + escapeRegex(botUsername) + '\\b\\s*',
            'i',
          );
          candidate = candidate.replace(mentionRe, '').trim();
        }
        if (/^\d{4}$/.test(candidate)) {
          const platformId = `tg:${ctx.chat.id}`;
          const isGroup = ctx.chat.type !== 'private';
          const chatNameForPair =
            isGroup
              ? ctx.chat.title || platformId
              : ctx.from?.first_name || ctx.from?.username || platformId;
          const senderForPair =
            ctx.from?.username || ctx.from?.first_name || ctx.from?.id?.toString() || null;
          try {
            const result = await this.config.consumePendingCode({
              code: candidate,
              channel: 'telegram',
              sender: senderForPair,
              platformId,
              isGroup,
              name: chatNameForPair,
              candidate: rawText,
            });
            if (result && result.matched) {
              // The host primitive now performs entity-model registration
              // on match (host commit c844d39). When it succeeds, the
              // chat is wired and the next inbound message will route to
              // the agent. When it fails (e.g. no main agent group has
              // been created yet, or the targeted agent_group_id is
              // unknown), `registered` is null and `registration_error`
              // carries a short human-readable reason so we can tell
              // the operator instead of pretending pairing worked.
              const registered = result.registered;
              const registrationError = result.registration_error;
              let confirmationText;
              if (registered) {
                const intentLabel =
                  typeof result.intent === 'string'
                    ? result.intent
                    : JSON.stringify(result.intent);
                confirmationText = `✓ Pairing success — this chat is now registered (intent: ${intentLabel}).`;
              } else {
                const reason = registrationError || 'unknown registration error';
                confirmationText =
                  `Pairing matched but registration failed: ${reason}. ` +
                  `Contact an admin — the chat will not receive agent replies until this is resolved.`;
              }
              try {
                await this.bot.api.sendMessage(ctx.chat.id, confirmationText);
              } catch (err) {
                this.logger.warn(
                  { err: err.message, chatId: ctx.chat.id },
                  'Failed to send pairing confirmation',
                );
              }
              if (registered) {
                this.logger.info(
                  {
                    platformId,
                    intent: result.intent,
                    agent_group_id: registered.agent_group_id,
                    messaging_group_id: registered.messaging_group_id,
                  },
                  'Telegram pairing code consumed and chat registered',
                );
              } else {
                this.logger.warn(
                  { platformId, intent: result.intent, registrationError },
                  'Telegram pairing code consumed but registration failed',
                );
              }
              return; // short-circuit — do NOT deliver to the agent
            }
          } catch (err) {
            // Fail open: a pairing primitive bug must not break normal traffic.
            this.logger.error(
              { err: err.message, candidate },
              'Pairing intercept threw; passing message through',
            );
          }
        }
      }

      const chatJid = `tg:${ctx.chat.id}`;
      let content = ctx.message.text;
      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id.toString() ||
        'Unknown';
      const sender = ctx.from?.id.toString() || '';
      const msgId = ctx.message.message_id.toString();

      // Determine chat name
      const chatName =
        ctx.chat.type === 'private'
          ? senderName
          : ctx.chat.title || chatJid;

      // Translate Telegram @bot_username mentions into trigger format.
      // Telegram @mentions (e.g., @andy_ai_bot) won't match the trigger
      // pattern (e.g., ^@TARS\b), so we prepend the trigger when the
      // bot is @mentioned.
      const botUsername = ctx.me?.username?.toLowerCase();
      if (botUsername) {
        const entities = ctx.message.entities || [];
        const isBotMentioned = entities.some((entity) => {
          if (entity.type === 'mention') {
            const mentionText = content
              .substring(entity.offset, entity.offset + entity.length)
              .toLowerCase();
            return mentionText === `@${botUsername}`;
          }
          return false;
        });
        if (isBotMentioned && !triggerPattern.test(content)) {
          content = `@${this.config.assistantName} ${content}`;
        }
      }

      // Store chat metadata for discovery
      this.config.onChatMetadata(chatJid, timestamp, chatName);

      // Only deliver full message for registered groups
      const group = this.config.registeredGroups()[chatJid];
      if (!group) {
        this.logger.debug(
          { chatJid, chatName },
          'Message from unregistered Telegram chat',
        );
        return;
      }

      // Extract reply context if this message is a reply
      let replyContext;
      const replyMsg = ctx.message.reply_to_message;
      if (replyMsg) {
        const replySender = replyMsg.from?.first_name || replyMsg.from?.username || replyMsg.from?.id?.toString() || 'unknown';
        const replyText = replyMsg.text || replyMsg.caption || null;
        replyContext = { sender_name: replySender, text: replyText };
      }

      // Deliver message — startMessageLoop() will pick it up
      this.config.onMessage(chatJid, {
        id: msgId,
        chat_jid: chatJid,
        sender,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: false,
        reply_context: replyContext,
      });

      this.logger.info(
        { chatJid, chatName, sender: senderName },
        'Telegram message stored',
      );
    });

    // Handle non-text messages with placeholders so the agent knows something was sent
    const storeNonText = (ctx, placeholder) => {
      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.config.registeredGroups()[chatJid];
      if (!group) return;

      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name || ctx.from?.username || ctx.from?.id?.toString() || 'Unknown';
      const caption = ctx.message.caption ? ` ${ctx.message.caption}` : '';

      // Extract reply context if this is a reply
      let replyContext;
      const replyMsg = ctx.message.reply_to_message;
      if (replyMsg) {
        const replySender = replyMsg.from?.first_name || replyMsg.from?.username || replyMsg.from?.id?.toString() || 'unknown';
        const replyText = replyMsg.text || replyMsg.caption || null;
        replyContext = { sender_name: replySender, text: replyText };
      }

      this.config.onChatMetadata(chatJid, timestamp);
      this.config.onMessage(chatJid, {
        id: ctx.message.message_id.toString(),
        chat_jid: chatJid,
        sender: ctx.from?.id?.toString() || '',
        sender_name: senderName,
        content: `${placeholder}${caption}`,
        timestamp,
        is_from_me: false,
        reply_context: replyContext,
      });
    };

    this.bot.on('message:photo', (ctx) => storeNonText(ctx, '[Photo]'));
    this.bot.on('message:video', (ctx) => storeNonText(ctx, '[Video]'));
    this.bot.on('message:voice', (ctx) => storeNonText(ctx, '[Voice message]'));
    this.bot.on('message:audio', (ctx) => storeNonText(ctx, '[Audio]'));
    this.bot.on('message:document', (ctx) => {
      const name = ctx.message.document?.file_name || 'file';
      storeNonText(ctx, `[Document: ${name}]`);
    });
    this.bot.on('message:sticker', (ctx) => {
      const emoji = ctx.message.sticker?.emoji || '';
      storeNonText(ctx, `[Sticker ${emoji}]`);
    });
    this.bot.on('message:location', (ctx) => storeNonText(ctx, '[Location]'));
    this.bot.on('message:contact', (ctx) => storeNonText(ctx, '[Contact]'));

    // Handle errors gracefully
    this.bot.catch((err) => {
      this.logger.error({ err: err.message }, 'Telegram bot error');
    });

    // Load swarm bot pool if pool.js is present and TELEGRAM_BOT_POOL is set
    if (process.env.TELEGRAM_BOT_POOL) {
      try {
        const { createPool } = await import('./pool.js');
        this.pool = await createPool(process.env.TELEGRAM_BOT_POOL, this.logger);
      } catch (err) {
        if (err.code === 'ERR_MODULE_NOT_FOUND') {
          this.logger.warn('TELEGRAM_BOT_POOL is set but pool.js not found — run /add-telegram-swarm to install');
        } else {
          this.logger.error({ err: err.message }, 'Failed to initialize bot pool');
        }
      }
    }

    // Start polling, with exponential-backoff retry around the cold-start
    // getMe call. Transient DNS / API hiccups during launchd boot would
    // otherwise crash the service immediately — 5 attempts (1s/2s/4s/8s/16s)
    // gives the network ~30s to settle before we surface the error.
    return withRetry(
      () =>
        new Promise((resolve, reject) => {
          let started = false;
          this.bot
            .start({
              onStart: (botInfo) => {
                started = true;
                this.logger.info(
                  { username: botInfo.username, id: botInfo.id },
                  'Telegram bot connected',
                );
                resolve();
              },
            })
            .catch((err) => {
              // bot.start() also resolves/rejects when polling stops; only
              // bubble up cold-start failures (where onStart never fired).
              if (!started) reject(err);
            });
        }),
      'bot.start',
      this.logger,
    );
  }

  async sendMessage(jid, text, sender, replyTo) {
    if (!this.bot) {
      this.logger.warn('Telegram bot not initialized');
      return;
    }

    // Route through pool bot when sender is provided and pool is available
    if (sender && this.pool) {
      await this.pool.sendMessage(jid, text, sender);
      return;
    }

    try {
      const numericId = jid.replace(/^tg:/, '');

      // Sanitise + send with parse_mode=Markdown so `**bold**` from the
      // assistant renders cleanly instead of literally. The sanitiser is
      // designed to avoid Telegram's legacy-Markdown crash modes (odd
      // delimiter counts, unbalanced brackets, CommonMark `**`).
      const sanitized = sanitizeTelegramLegacyMarkdown(text);

      // Telegram has a 4096 character limit per message — split if needed.
      const MAX_LENGTH = 4096;
      const replyParams = replyTo ? { reply_parameters: { message_id: parseInt(replyTo, 10) } } : {};
      const chunks = splitForLimit(sanitized, MAX_LENGTH);
      for (let i = 0; i < chunks.length; i++) {
        const baseParams = i === 0 ? { ...replyParams } : {};
        try {
          await this.bot.api.sendMessage(numericId, chunks[i], {
            ...baseParams,
            parse_mode: 'Markdown',
          });
        } catch (err) {
          // Graceful degradation: if Markdown parsing rejects the chunk
          // (rare, since the sanitiser guards against the known crash modes),
          // retry as plain text so the user still gets the message.
          this.logger.warn(
            { jid, err: err.message || err },
            'Markdown send failed, retrying as plain text',
          );
          await this.bot.api.sendMessage(numericId, chunks[i], baseParams);
        }
      }
      this.logger.info({ jid, length: text.length }, 'Telegram message sent');
    } catch (err) {
      this.logger.error({ jid, err }, 'Failed to send Telegram message');
    }
  }

  async sendFile(jid, buffer, mime, fileName, caption) {
    if (!this.bot) {
      this.logger.warn('Telegram bot not initialized');
      return;
    }

    const numericId = jid.replace(/^tg:/, '');
    const clippedCaption = clipCaption(caption);
    const kind = detectMediaKind(fileName, mime);
    const file = new InputFile(buffer, fileName);

    // Try the typed media call first so images/videos/audio render inline.
    // On any failure (Telegram rejects the format, network blip, etc.) we
    // fall back to sendDocument so the user at least gets the file.
    if (kind === 'photo') {
      try {
        await this.bot.api.sendPhoto(numericId, file, { caption: clippedCaption });
        this.logger.info({ jid, fileName, mime, kind }, 'Telegram media sent');
        return;
      } catch (err) {
        this.logger.warn({ jid, fileName, err: err.message || err }, 'sendPhoto failed, falling back to sendDocument');
      }
    } else if (kind === 'video') {
      try {
        await this.bot.api.sendVideo(numericId, file, { caption: clippedCaption });
        this.logger.info({ jid, fileName, mime, kind }, 'Telegram media sent');
        return;
      } catch (err) {
        this.logger.warn({ jid, fileName, err: err.message || err }, 'sendVideo failed, falling back to sendDocument');
      }
    } else if (kind === 'audio') {
      try {
        await this.bot.api.sendAudio(numericId, file, { caption: clippedCaption });
        this.logger.info({ jid, fileName, mime, kind }, 'Telegram media sent');
        return;
      } catch (err) {
        this.logger.warn({ jid, fileName, err: err.message || err }, 'sendAudio failed, falling back to sendDocument');
      }
    }

    // Fallback path (also the default for non-media file types).
    try {
      // InputFile is single-use (consumes the buffer stream); rebuild for the retry.
      const docFile = new InputFile(buffer, fileName);
      await this.bot.api.sendDocument(numericId, docFile, { caption: clippedCaption });
      this.logger.info({ jid, fileName, mime, kind: 'document' }, 'Telegram document sent');
    } catch (err) {
      this.logger.error({ jid, fileName, err: err.message || err }, 'Failed to send Telegram file');
      throw err;
    }
  }

  async react(jid, messageId, emoji) {
    if (!this.bot) {
      this.logger.warn('Telegram bot not initialized');
      return;
    }
    try {
      const numericId = jid.replace(/^tg:/, '');
      await this.bot.api.setMessageReaction(numericId, parseInt(messageId, 10), [{ type: 'emoji', emoji }]);
      this.logger.info({ jid, messageId, emoji }, 'Telegram reaction sent');
    } catch (err) {
      this.logger.error({ jid, messageId, emoji, err }, 'Failed to send Telegram reaction');
    }
  }

  isConnected() {
    return this.bot !== null;
  }

  ownsJid(jid) {
    return jid.startsWith('tg:');
  }

  async disconnect() {
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
      this.logger.info('Telegram bot stopped');
    }
  }
}

export async function onChannel(ctx, config) {
  const channel = new TelegramChannel(config, ctx.logger);
  return channel;
}
