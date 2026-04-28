import { Client, GatewayIntentBits, Partials } from 'discord.js';

const MESSAGE_MAX_LENGTH = 2000;

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

class DiscordChannel {
  name = 'discord';

  /** @private @type {Client | null} */
  client = null;
  /** @private */
  connected = false;
  /** @private */
  shuttingDown = false;
  /** @private @type {import('../../src/plugin-types.js').ChannelPluginConfig} */
  config;
  /** @private */
  logger;

  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  async connect() {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      this.logger.warn('DISCORD_BOT_TOKEN not set — skipping Discord channel');
      return;
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel], // needed to receive DM events
    });

    return new Promise((resolve) => {
      this.client.once('clientReady', () => {
        this.connected = true;
        this.logger.info(
          { username: this.client.user?.tag, id: this.client.user?.id },
          'Discord bot connected',
        );
        resolve();
      });

      this.client.on('messageCreate', async (message) => {
        // Ignore messages from bots (including self)
        if (message.author.bot) return;

        const chatJid = `dc:${message.channelId}`;
        const timestamp = message.createdAt.toISOString();
        const senderName = message.member?.displayName || message.author.displayName || message.author.username;
        const sender = message.author.id;
        const msgId = message.id;

        // Determine chat name
        let chatName;
        if (message.guild) {
          chatName = message.channel.name || chatJid;
        } else {
          chatName = senderName;
        }

        // Report chat metadata for discovery
        this.config.onChatMetadata(chatJid, timestamp, chatName);

        // Cross-channel pairing-codes intercept (host primitive — see
        // nanotars src/pending-codes.ts and the /register-group admin
        // command). When the inbound text is exactly 4 digits, try to
        // consume the code BEFORE the registered-chat filter — otherwise
        // pairing codes from unregistered chats would be silently dropped
        // and the operator could never claim the chat. Mirrors Telegram
        // intercept in plugins/channels/telegram/index.js:296.
        if (typeof this.config.consumePendingCode === 'function') {
          const candidate = (message.content || '').trim();
          if (/^\d{4}$/.test(candidate)) {
            const isGroup = Boolean(message.guild);
            try {
              const result = await this.config.consumePendingCode({
                code: candidate,
                channel: 'discord',
                sender: senderName,
                platformId: chatJid,
                isGroup,
                name: chatName,
                candidate: message.content,
              });
              if (result && result.matched) {
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
                  await message.reply(confirmationText);
                } catch (err) {
                  this.logger.warn(
                    { err: err.message, chatJid },
                    'Failed to send Discord pairing confirmation',
                  );
                }
                if (registered) {
                  this.logger.info(
                    {
                      platformId: chatJid,
                      intent: result.intent,
                      agent_group_id: registered.agent_group_id,
                      messaging_group_id: registered.messaging_group_id,
                    },
                    'Discord pairing code consumed and chat registered',
                  );
                } else {
                  this.logger.warn(
                    { platformId: chatJid, intent: result.intent, registrationError },
                    'Discord pairing code consumed but registration failed',
                  );
                }
                return; // short-circuit — do NOT deliver to the agent
              }
            } catch (err) {
              // Fail open: a pairing primitive bug must not break normal traffic.
              this.logger.error(
                { err: err.message, candidate },
                'Discord pairing intercept threw; passing message through',
              );
            }
          }
        }

        // Only deliver full message for registered chats
        const groups = this.config.registeredGroups();
        if (!groups[chatJid]) return;

        let content = message.content || '';

        // Handle attachments as text placeholders
        for (const attachment of message.attachments.values()) {
          const type = attachment.contentType?.startsWith('image/')
            ? 'Image'
            : attachment.contentType?.startsWith('video/')
              ? 'Video'
              : attachment.contentType?.startsWith('audio/')
                ? 'Audio'
                : 'File';
          content += content ? `\n[${type}: ${attachment.name}]` : `[${type}: ${attachment.name}]`;
        }

        // Handle stickers
        for (const sticker of message.stickers.values()) {
          content += content ? `\n[Sticker: ${sticker.name}]` : `[Sticker: ${sticker.name}]`;
        }

        if (!content) return;

        // Extract reply context if this message is a reply
        let replyContext;
        if (message.reference?.messageId) {
          try {
            // Try cache first to avoid network round-trip, fall back to fetch
            const refMsg = message.channel.messages.cache.get(message.reference.messageId)
              || await message.channel.messages.fetch(message.reference.messageId);
            const replySender = refMsg.member?.displayName || refMsg.author?.displayName || refMsg.author?.username || 'unknown';
            const replyText = refMsg.content || null;
            replyContext = { sender_name: replySender, text: replyText };
          } catch {
            // Referenced message deleted or inaccessible — skip reply context
          }
        }

        this.config.onMessage(chatJid, {
          id: msgId,
          chat_jid: chatJid,
          sender,
          sender_name: senderName,
          content,
          timestamp,
          is_from_me: false,
          is_bot_message: false,
          reply_context: replyContext,
        });

        this.logger.info(
          { chatJid, chatName, sender: senderName },
          'Discord message stored',
        );
      });

      this.client.on('error', (err) => {
        this.logger.error({ err: err.message }, 'Discord client error');
      });

      this.client.login(token);
    });
  }

  async sendMessage(jid, text, sender, replyTo) {
    if (!this.client) {
      this.logger.warn('Discord client not initialized');
      return;
    }

    const channelId = jid.replace(/^dc:/, '');

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel?.isTextBased()) {
        this.logger.warn({ jid }, 'Discord channel not found or not text-based');
        return;
      }

      // Discord has a 2000 character limit per message — split if needed
      const chunks = splitForLimit(text, MESSAGE_MAX_LENGTH);
      if (chunks.length === 1) {
        if (replyTo) {
          try {
            const refMsg = channel.messages.cache.get(replyTo) || await channel.messages.fetch(replyTo);
            await refMsg.reply(chunks[0]);
          } catch {
            await channel.send(chunks[0]);
          }
        } else {
          await channel.send(chunks[0]);
        }
      } else {
        for (const chunk of chunks) {
          await channel.send(chunk);
        }
      }

      this.logger.info({ jid, length: text.length }, 'Discord message sent');
    } catch (err) {
      this.logger.error({ jid, err }, 'Failed to send Discord message');
    }
  }

  async react(jid, messageId, emoji) {
    if (!this.client) {
      this.logger.warn('Discord client not initialized');
      return;
    }
    const channelId = jid.replace(/^dc:/, '');
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel?.isTextBased()) return;
      const message = channel.messages.cache.get(messageId) || await channel.messages.fetch(messageId);
      await message.react(emoji);
      this.logger.info({ jid, messageId, emoji }, 'Discord reaction sent');
    } catch (err) {
      this.logger.error({ jid, messageId, emoji, err }, 'Failed to send Discord reaction');
    }
  }

  isConnected() {
    return this.connected;
  }

  ownsJid(jid) {
    return jid.startsWith('dc:');
  }

  async disconnect() {
    this.shuttingDown = true;
    this.connected = false;
    if (this.client) {
      this.client.destroy();
      this.client = null;
      this.logger.info('Discord bot stopped');
    }
  }

  async listAvailableGroups() {
    if (!this.client) return [];

    const results = [];

    // List guild text channels
    for (const guild of this.client.guilds.cache.values()) {
      for (const channel of guild.channels.cache.values()) {
        if (channel.isTextBased() && !channel.isVoiceBased()) {
          results.push({
            jid: `dc:${channel.id}`,
            name: `${guild.name} / #${channel.name}`,
          });
        }
      }
    }

    return results;
  }
}

export async function onChannel(ctx, config) {
  const channel = new DiscordChannel(config, ctx.logger);
  return channel;
}
