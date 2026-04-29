import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const execFileAsync = promisify(execFile);

import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { useSqliteAuthState } from './sqlite-auth-state.js';

// Patch Baileys v6 getPlatformId so pairing codes work (mirrors qwibitai/nanoclaw v2 src/channels/whatsapp.ts:51).
// Baileys v6 bug: getPlatformId sends charCode (49) instead of enum value (1).
// Fixed in 7.x but not backported. Without this, pairing codes fail with
// "couldn't link device" because WhatsApp receives an invalid platform ID.
// createRequire is needed because proto is not exposed as a named ESM export.
const _require = createRequire(import.meta.url);
const { proto } = _require('@whiskeysockets/baileys');
try {
  const _generics = _require('@whiskeysockets/baileys/lib/Utils/generics');
  _generics.getPlatformId = (browser) => {
    const platformType = proto.DeviceProps.PlatformType[browser.toUpperCase()];
    return platformType ? platformType.toString() : '1';
  };
} catch {
  // CJS require failed (Node version mismatch?) — pairing codes may not work
  // but QR auth will still function fine.
}

const GROUP_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_OUTGOING_QUEUE = 200;
const SENT_MESSAGE_CACHE_MAX = 256;

// --- Markdown → WhatsApp formatting ---
// Mirrors qwibitai/nanoclaw v2 src/channels/whatsapp.ts:79-126.

/** Split text into code-block-protected and unprotected regions. */
function splitProtectedRegions(text) {
  const segments = [];
  const codeBlockRegex = /```[\s\S]*?```|`[^`\n]+`/g;
  let lastIndex = 0;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ content: text.slice(lastIndex, match.index), isProtected: false });
    }
    segments.push({ content: match[0], isProtected: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ content: text.slice(lastIndex), isProtected: false });
  }
  return segments;
}

/** Apply WhatsApp-native formatting to an unprotected text segment. */
function transformForWhatsApp(text) {
  // Order matters: italic before bold to avoid **bold** → *bold* → _bold_
  // 1. Italic: *text* (not **) → _text_
  text = text.replace(/(?<!\*)\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?!\*)/g, '_$1_');
  // 2. Bold: **text** → *text*
  text = text.replace(/\*\*(?=[^\s*])([^*]+?)(?<=[^\s*])\*\*/g, '*$1*');
  // 3. Headings: ## Title → *Title*
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
  // 4. Links: [text](url) → text (url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  // 5. Horizontal rules: --- / *** / ___ → stripped
  text = text.replace(/^(-{3,}|\*{3,}|_{3,})$/gm, '');
  return text;
}

/** Convert standard markdown to WhatsApp-native formatting, preserving code fences. */
function formatWhatsApp(text) {
  if (!text) return text;
  const segments = splitProtectedRegions(text);
  return segments
    .map(({ content, isProtected }) => (isProtected ? content : transformForWhatsApp(content)))
    .join('');
}

class WhatsAppChannel {
  name = 'whatsapp';

  /** @private */
  sock;
  /** @private */
  connected = false;
  /** @private */
  shuttingDown = false;
  /** @private */
  lidToPhoneMap = {};
  /** @private */
  outgoingQueue = [];
  /** @private */
  flushing = false;
  /** @private */
  groupSyncTimerStarted = false;
  /**
   * Recently-sent messages keyed by message id. Baileys' getMessage callback
   * is invoked when WhatsApp asks us to resend a message that needs to be
   * re-encrypted for a peer that lost it (typical on retry). Without this,
   * peers see "Waiting for this message" indefinitely.
   * @private
   */
  sentMessageCache = new Map();
  /** @private */
  ffmpegAvailable = false;
  /** @private */
  ffmpegChecked = false;
  /** @private */
  reconnectAttempt = 0;
  /**
   * Per-jid set of chats where the bot has just replied; setTyping silently
   * skips 'composing' for these jids until the user sends a new inbound,
   * which clears the flag. Without this, the orchestrator's 4s polling
   * interval re-asserts the typing indicator on top of our `paused` while
   * the agent's runAgent is still finishing post-send work (tool calls,
   * cleanup), so the indicator looks permanent until WA's ~25s expire.
   * @private
   */
  typingSuppressed = new Set();
  /** @private */
  config;
  /** @private */
  logger;

  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.connectInternal(resolve).catch(reject);
    });
  }

  /** @private */
  async connectInternal(onFirstOpen) {
    const authDir = path.join(this.config.paths.channelsDir, 'whatsapp', 'auth');
    fs.mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useSqliteAuthState(authDir, this.logger);

    if (!this.ffmpegChecked) {
      this.ffmpegChecked = true;
      try {
        await execFileAsync('ffmpeg', ['-version'], { timeout: 5000 });
        this.ffmpegAvailable = true;
        this.logger.info('ffmpeg detected — video thumbnails enabled');
      } catch {
        this.ffmpegAvailable = false;
        this.logger.warn('ffmpeg not found — video thumbnails will use low-res fallback');
      }
    }

    let waVersion;
    try {
      const { version } = await fetchLatestWaWebVersion({});
      waVersion = version;
      this.logger.info({ version }, 'Fetched latest WA Web version');
    } catch (e) {
      this.logger.warn({ err: e.message }, 'Failed to fetch WA Web version, using default');
    }

    this.sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, this.logger),
      },
      ...(waVersion && { version: waVersion }),
      printQRInTerminal: false,
      logger: this.logger,
      browser: Browsers.macOS('Chrome'),
      // Feed Baileys recently-sent messages on retry so peers don't see
      // "Waiting for this message". Mirrors qwibitai/nanoclaw v2
      // src/channels/whatsapp.ts:367-373.
      getMessage: async (key) => {
        const cached = this.sentMessageCache.get(key.id || '');
        if (cached) return cached;
        return proto.Message.fromObject({});
      },
      syncFullHistory: false,
    });

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        const msg =
          'WhatsApp authentication required. Run /add-channel-whatsapp in Claude Code.';
        this.logger.error(msg);
        exec(
          `osascript -e 'display notification "${msg}" with title "NanoClaw" sound name "Basso"'`,
        );
        setTimeout(() => process.exit(1), 1000);
      }

      if (connection === 'close') {
        this.connected = false;
        const reason = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut && !this.shuttingDown;
        this.logger.info({ reason, shouldReconnect, queuedMessages: this.outgoingQueue.length }, 'Connection closed');

        if (shouldReconnect) {
          this.scheduleReconnect();
        } else {
          this.logger.info('Logged out. Run /add-channel-whatsapp to re-authenticate.');
          process.exit(0);
        }
      } else if (connection === 'open') {
        this.connected = true;
        this.reconnectAttempt = 0;
        this.logger.info('Connected to WhatsApp');

        // Build LID to phone mapping from auth state for self-chat translation
        if (this.sock.user) {
          const phoneUser = this.sock.user.id.split(':')[0];
          const lidUser = this.sock.user.lid?.split(':')[0];
          if (lidUser && phoneUser) {
            this.setLidPhoneMapping(lidUser, `${phoneUser}@s.whatsapp.net`);
          }
        }

        // Announce online presence
        this.sock.sendPresenceUpdate('available').catch((err) =>
          this.logger.debug({ err }, 'Failed to send initial presence'),
        );

        // Flush any messages queued while disconnected
        this.flushOutgoingQueue().catch((err) =>
          this.logger.error({ err }, 'Failed to flush outgoing queue'),
        );

        // Sync group metadata on startup (respects 24h cache)
        this.syncGroupMetadata().catch((err) =>
          this.logger.error({ err }, 'Initial group sync failed'),
        );
        // Set up daily sync timer (only once)
        if (!this.groupSyncTimerStarted) {
          this.groupSyncTimerStarted = true;
          setInterval(() => {
            this.syncGroupMetadata().catch((err) =>
              this.logger.error({ err }, 'Periodic group sync failed'),
            );
          }, GROUP_SYNC_INTERVAL_MS);
        }

        // Signal first connection to caller
        if (onFirstOpen) {
          onFirstOpen();
          onFirstOpen = undefined;
        }
      }
    });

    this.sock.ev.on('creds.update', saveCreds);

    // Listen for phone-number share events so we can populate the LID→phone
    // cache as soon as a contact shares their number — mirrors qwibitai/nanoclaw
    // v2 src/channels/whatsapp.ts:481.
    this.sock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
      const lidUser = lid?.split('@')[0]?.split(':')[0];
      if (lidUser && jid) {
        this.setLidPhoneMapping(lidUser, jid);
      }
    });

    this.sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        try {
        if (!msg.message) continue;
        const rawJid = msg.key.remoteJid;
        if (!rawJid || rawJid === 'status@broadcast') continue;

        // Unwrap WhatsApp message wrappers (viewOnce, ephemeral, documentWithCaption)
        let inner = msg.message;
        if (inner?.ephemeralMessage) inner = inner.ephemeralMessage.message;
        if (inner?.viewOnceMessage) inner = inner.viewOnceMessage.message;
        if (inner?.viewOnceMessageV2) inner = inner.viewOnceMessageV2.message;
        if (inner?.documentWithCaptionMessage) inner = inner.documentWithCaptionMessage.message;
        // Replace msg.message with unwrapped inner for downstream processing
        if (inner && inner !== msg.message) {
          msg.message = inner;
        }

        // Skip system messages that carry no user text (reactions, edits, protocol).
        // senderKeyDistributionMessage is NOT filtered — WhatsApp bundles it
        // alongside actual text during group key rotation.
        const msgKeys = Object.keys(msg.message);
        if (msgKeys.length === 1 &&
            ['protocolMessage', 'reactionMessage', 'editedMessage'].includes(msgKeys[0])) {
          continue;
        }

        // If WhatsApp included senderPn on the message key, learn the
        // LID→phone mapping for the sender before translating — this both
        // populates the cache for future messages and lets translateJid
        // resolve the current rawJid without an extra signalRepository call.
        // Mirrors qwibitai/nanoclaw v2 src/channels/whatsapp.ts:497-504.
        if (rawJid.endsWith('@lid') && msg.key.senderPn) {
          const pn = msg.key.senderPn;
          const phoneJid = pn.includes('@') ? pn : `${pn}@s.whatsapp.net`;
          const lidUser = rawJid.split('@')[0].split(':')[0];
          this.setLidPhoneMapping(lidUser, phoneJid);
        }

        // Translate LID JID to phone JID if applicable
        const chatJid = await this.translateJid(rawJid);

        const timestamp = new Date(
          Number(msg.messageTimestamp) * 1000,
        ).toISOString();

        // Always notify about chat metadata for group discovery
        this.config.onChatMetadata(chatJid, timestamp);

        // The user just sent a new message in this chat — clear any
        // post-reply typing-suppression so the next setTyping poll can
        // legitimately show the bot composing again. Skip for fromMe so
        // the bot's own outbound echo doesn't clear the suppression it
        // just set in sendMessage.
        if (!msg.key.fromMe) {
          this.typingSuppressed.delete(chatJid);
        }

        // Cross-channel pairing-codes intercept (host primitive — see
        // nanotars src/pending-codes.ts and the /register-group admin
        // command). When the inbound text is exactly 4 digits, try to
        // consume the code BEFORE the registered-chat filter — otherwise
        // pairing codes from unregistered chats would be silently dropped
        // and the operator could never claim the chat. Mirrors Telegram
        // intercept in plugins/channels/telegram/index.js:296.
        if (typeof this.config.consumePendingCode === 'function') {
          const rawText =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text || '';
          const candidate = rawText.trim();
          if (/^\d{4}$/.test(candidate)) {
            const isGroup = chatJid.endsWith('@g.us');
            const rawSender = msg.key.participant || msg.key.remoteJid || '';
            const senderJid = await this.translateJid(rawSender);
            const senderHandle = senderJid.split('@')[0] || null;
            const senderForPair = msg.pushName || senderHandle || null;
            const senderUserId = senderHandle ? `whatsapp:${senderHandle}` : null;
            const chatNameForPair = msg.pushName || chatJid;
            try {
              const result = await this.config.consumePendingCode({
                code: candidate,
                channel: 'whatsapp',
                sender: senderForPair,
                senderUserId,
                platformId: chatJid,
                isGroup,
                name: chatNameForPair,
                candidate: rawText,
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
                  await this.sock.sendMessage(rawJid, { text: confirmationText });
                } catch (err) {
                  this.logger.warn(
                    { err: err.message, chatJid },
                    'Failed to send WhatsApp pairing confirmation',
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
                    'WhatsApp pairing code consumed and chat registered',
                  );
                } else {
                  this.logger.warn(
                    { platformId: chatJid, intent: result.intent, registrationError },
                    'WhatsApp pairing code consumed but registration failed',
                  );
                }
                continue; // short-circuit — do NOT deliver to the agent
              }
            } catch (err) {
              // Fail open: a pairing primitive bug must not break normal traffic.
              this.logger.error(
                { err: err.message, candidate },
                'WhatsApp pairing intercept threw; passing message through',
              );
            }
          }
        }

        // Only deliver full message for registered chats. The legacy
        // registeredGroups() Record<jid> was replaced by the entity-model
        // resolveAgentsForInbound(channel, platformId) accessor — empty
        // array means the chat has no agent_group wiring.
        const wirings = this.config.resolveAgentsForInbound('whatsapp', chatJid);
        if (wirings.length > 0) {
          const agentGroup = wirings[0].agentGroup;
          let content =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            '';

          // Translate @mention IDs to @DisplayName so trigger patterns match.
          // WhatsApp encodes mentions as @LID or @phonenumber in the text,
          // not the display name shown in the UI.
          const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
          if (mentionedJids.length > 0 && content) {
            const myPhone = this.sock?.user?.id?.split(':')[0];
            const myLid = this.sock?.user?.lid?.split(':')[0];
            for (const jid of mentionedJids) {
              const id = jid.split('@')[0];
              if ((myPhone && id === myPhone) || (myLid && id === myLid)) {
                content = content.replace(new RegExp(`@${id}\\b`, 'g'), `@${this.config.assistantName}`);
              }
            }
          }

          const rawSender = msg.key.participant || msg.key.remoteJid || '';
          const sender = await this.translateJid(rawSender);
          const senderName = msg.pushName || sender.split('@')[0];

          const fromMe = msg.key.fromMe || false;
          // Detect bot messages: with own number, fromMe is reliable
          // since only the bot sends from that number.
          // With shared number, bot messages carry the assistant name prefix
          // (even in DMs/self-chat) so we check for that.
          const isBotMessage = this.config.assistantHasOwnNumber
            ? fromMe
            : content.startsWith(`${this.config.assistantName}:`);

          // Extract reply context if this message is a reply
          let replyContext;
          const ctxInfo = msg.message?.extendedTextMessage?.contextInfo
            || msg.message?.imageMessage?.contextInfo
            || msg.message?.videoMessage?.contextInfo
            || msg.message?.documentMessage?.contextInfo
            || msg.message?.audioMessage?.contextInfo;
          if (ctxInfo?.quotedMessage) {
            const quotedText = ctxInfo.quotedMessage.conversation
              || ctxInfo.quotedMessage.extendedTextMessage?.text
              || ctxInfo.quotedMessage.imageMessage?.caption
              || ctxInfo.quotedMessage.videoMessage?.caption
              || null;
            const rawQuotedSender = ctxInfo.participant || '';
            const quotedSender = rawQuotedSender ? await this.translateJid(rawQuotedSender) : '';
            // Use assistant name if replying to the bot's own message
            const myPhone = this.sock?.user?.id?.split(':')[0];
            const quotedPhone = quotedSender?.split('@')[0];
            const quotedName = (myPhone && quotedPhone === myPhone)
              ? this.config.assistantName
              : (quotedSender ? quotedSender.split('@')[0] : 'unknown');
            replyContext = {
              sender_name: quotedName,
              text: quotedText,
            };
          }

          // Download media (images, videos, documents, audio) if present
          const hasMedia = msg.message?.imageMessage || msg.message?.videoMessage ||
            msg.message?.documentMessage || msg.message?.audioMessage;
          let mediaType;
          let mediaPath;
          let mediaHostPath;
          if (hasMedia) {
            const media = await this.downloadMedia(msg, agentGroup.folder);
            if (media) {
              mediaType = media.type;
              mediaPath = media.path;
              mediaHostPath = media.hostPath;
              if (media.thumbnailPath) {
                // Video with thumbnail — show both references so agent can preview
                content = content
                  ? `${content}\n[${media.type}: ${media.path}]\n[thumbnail: ${media.thumbnailPath}]`
                  : `[${media.type}: ${media.path}]\n[thumbnail: ${media.thumbnailPath}]`;
              } else {
                content = content
                  ? `${content}\n[${media.type}: ${media.path}]`
                  : `[${media.type}: ${media.path}]`;
              }
            } else if (!content) {
              // Media download failed and no caption — add placeholder so message isn't dropped
              const type = msg.message?.imageMessage ? 'image' : msg.message?.videoMessage ? 'video'
                : msg.message?.audioMessage ? 'audio' : 'document';
              content = `[${type}: download failed]`;
            }
          }

          // Skip protocol messages with no content (encryption keys, read receipts, etc.)
          if (!content) continue;

          this.config.onMessage(chatJid, {
            id: msg.key.id || '',
            chat_jid: chatJid,
            sender,
            sender_name: senderName,
            content,
            timestamp,
            is_from_me: fromMe,
            is_bot_message: isBotMessage,
            mediaType,
            mediaPath,
            mediaHostPath,
            reply_context: replyContext,
          });
        }

        // Send read receipt for incoming messages
        if (!msg.key.fromMe) {
          this.sock.readMessages([msg.key]).then(() => {
            this.logger.info(
              { remoteJid: msg.key.remoteJid, msgId: msg.key.id },
              'WhatsApp read receipt sent',
            );
          }).catch((err) => {
            this.logger.warn(
              { remoteJid: msg.key.remoteJid, msgId: msg.key.id, err: err.message },
              'WhatsApp read receipt failed',
            );
          });
        }
        } catch (err) {
          this.logger.error(
            { err, remoteJid: msg.key?.remoteJid, msgId: msg.key?.id },
            'Error processing message, skipping',
          );
        }
      }
    });
  }

  /** Reconnect with exponential backoff: 2s → 4s → 8s → ... capped at 5 minutes. */
  scheduleReconnect() {
    const delay = Math.min(2000 * Math.pow(2, this.reconnectAttempt), 300000);
    this.reconnectAttempt++;
    this.logger.info({ delay, attempt: this.reconnectAttempt }, 'Scheduling reconnect');
    setTimeout(() => {
      this.connectInternal().catch((err) => {
        this.logger.error({ err, attempt: this.reconnectAttempt }, 'Reconnect failed');
        this.scheduleReconnect();
      });
    }, delay);
  }

  async sendMessage(jid, text, sender, replyTo) {
    // Convert standard markdown to WhatsApp-native formatting (bold/italic
    // syntax, headings, links). Code fences are preserved verbatim. Run
    // before the sender/assistant prefix so the prefix's own asterisks
    // aren't fed back through the regex.
    const formatted = formatWhatsApp(text);

    // If a subagent identity is specified, prefix with its name in bold
    const withSender = sender && sender !== this.config.assistantName
      ? `*${sender}*\n━━━━━━━━━━━━━━\n${formatted}`
      : formatted;

    // Prefix bot messages with assistant name so users know who's speaking.
    // On a shared number, prefix is also needed in DMs (including self-chat)
    // to distinguish bot output from user messages.
    // Skip only when the assistant has its own dedicated phone number.
    const prefixed = this.config.assistantHasOwnNumber
      ? withSender
      : `${this.config.assistantName}: ${withSender}`;

    if (!this.connected) {
      if (this.outgoingQueue.length >= MAX_OUTGOING_QUEUE) {
        const dropped = this.outgoingQueue.shift();
        this.logger.warn({ jid: dropped.jid, queueSize: this.outgoingQueue.length }, 'Outgoing queue full, dropped oldest message');
      }
      this.outgoingQueue.push({ jid, text: prefixed, replyTo });
      this.logger.info({ jid, length: prefixed.length, queueSize: this.outgoingQueue.length }, 'WA disconnected, message queued');
      return;
    }
    try {
      const msg = { text: prefixed };
      if (replyTo) {
        msg.quoted = { key: { remoteJid: jid, id: replyTo, fromMe: false } };
      }
      const sent = await this.sock.sendMessage(jid, msg);
      this.rememberSentMessage(sent);
      this.logger.info({ jid, length: prefixed.length }, 'Message sent');
      // Clear the typing indicator. The orchestrator polls setTyping every
      // 4s while generating; without suppression here, ticks that fire after
      // our reply (during runAgent post-send work) would re-assert
      // `composing` on top of the paused. Cleared on next inbound from this
      // chat — see messages.upsert handler.
      this.typingSuppressed.add(jid);
      this.sock.sendPresenceUpdate('paused', jid).catch(() => {});
    } catch (err) {
      // If send fails, queue it for retry on reconnect
      this.outgoingQueue.push({ jid, text: prefixed, replyTo });
      this.logger.warn({ jid, err, queueSize: this.outgoingQueue.length }, 'Failed to send, message queued');
    }
  }

  async sendFile(jid, buffer, mime, fileName, caption) {
    if (!this.connected) {
      this.logger.warn({ jid, fileName }, 'WA disconnected, cannot send file');
      return;
    }
    try {
      let sent;
      if (mime.startsWith('image/')) {
        sent = await this.sock.sendMessage(jid, { image: buffer, caption });
      } else if (mime.startsWith('video/')) {
        sent = await this.sock.sendMessage(jid, { video: buffer, caption });
      } else if (mime.startsWith('audio/')) {
        sent = await this.sock.sendMessage(jid, { audio: buffer });
      } else {
        sent = await this.sock.sendMessage(jid, { document: buffer, mimetype: mime, fileName, caption });
      }
      this.rememberSentMessage(sent);
      this.logger.info({ jid, fileName, mime }, 'File sent');
    } catch (err) {
      this.logger.error({ jid, fileName, err }, 'Failed to send file');
      throw err;
    }
  }

  async react(jid, messageId, emoji, participant, fromMe) {
    if (!this.connected) {
      this.logger.warn({ jid, messageId }, 'WA disconnected, cannot react');
      return;
    }
    try {
      const key = { remoteJid: jid, id: messageId, fromMe: fromMe ?? false };
      // Group reactions require participant (sender JID) in the key
      if (participant && jid.endsWith('@g.us')) {
        key.participant = participant;
      }
      await this.sock.sendMessage(jid, { react: { text: emoji, key } });
      this.logger.info({ jid, messageId, emoji, participant, fromMe }, 'Reaction sent');
    } catch (err) {
      this.logger.error({ jid, messageId, emoji, err }, 'Failed to send reaction');
    }
  }

  isConnected() {
    return this.connected;
  }

  ownsJid(jid) {
    return jid.endsWith('@g.us') || jid.endsWith('@s.whatsapp.net');
  }

  /**
   * Extract a JPEG thumbnail from a video file.
   * Tries ffmpeg first, falls back to Baileys' embedded jpegThumbnail.
   * @private
   * @returns {Promise<string|null>} Host path to thumbnail, or null on failure
   */
  async extractThumbnail(videoPath, thumbnailPath, jpegThumbnail) {
    if (this.ffmpegAvailable) {
      try {
        await execFileAsync('ffmpeg', [
          '-i', videoPath, '-frames:v', '1', '-q:v', '2', '-y', thumbnailPath,
        ], { timeout: 10000 });
        this.logger.debug({ thumbnailPath }, 'Thumbnail extracted via ffmpeg');
        return thumbnailPath;
      } catch (err) {
        this.logger.warn({ err }, 'ffmpeg thumbnail extraction failed, trying fallback');
      }
    }

    // Fallback: use Baileys' embedded low-res thumbnail
    if (jpegThumbnail && Buffer.isBuffer(jpegThumbnail) && jpegThumbnail.length > 0) {
      try {
        fs.writeFileSync(thumbnailPath, jpegThumbnail);
        this.logger.debug({ thumbnailPath }, 'Thumbnail written from Baileys jpegThumbnail');
        return thumbnailPath;
      } catch (err) {
        this.logger.warn({ err }, 'Failed to write jpegThumbnail fallback');
      }
    }

    return null;
  }

  /**
   * Download media from a WhatsApp message and save to the group's media directory.
   * Returns a container-relative path reference, or null if no media or download failed.
   * For videos, extracts a JPEG thumbnail so the agent can preview the content.
   * For GIFs (gifPlayback videos), returns the thumbnail as an image instead.
   * @private
   */
  detectMimeFromBuffer(buffer) {
    if (!buffer || buffer.length < 12) return null;
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return { mime: 'image/png', ext: 'png' };
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return { mime: 'image/gif', ext: 'gif' };
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
        && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return { mime: 'image/webp', ext: 'webp' };
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return { mime: 'application/pdf', ext: 'pdf' };
    return null;
  }

  async downloadMedia(msg, groupFolder) {
    const mediaTypes = [
      { key: 'imageMessage', type: 'image', ext: 'jpg' },
      { key: 'videoMessage', type: 'video', ext: 'mp4' },
      { key: 'documentMessage', type: 'document', ext: '' },
      { key: 'audioMessage', type: 'audio', ext: 'ogg' },
    ];

    for (const mt of mediaTypes) {
      const mediaMsg = msg.message?.[mt.key];
      if (!mediaMsg) continue;

      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        let ext = mt.ext || mediaMsg.fileName?.split('.').pop() || 'bin';

        // Detect actual MIME from magic bytes — WhatsApp metadata can lie
        const detected = this.detectMimeFromBuffer(buffer);
        if (detected && mt.type === 'image') {
          const declared = mediaMsg.mimetype || `image/${ext}`;
          if (detected.mime !== declared) {
            this.logger.warn({ declared, actual: detected.mime, msgId: msg.key.id }, 'MIME mismatch detected via magic bytes');
            ext = detected.ext;
          }
        }

        const filename = `${msg.key.id}.${ext}`;
        const mediaDir = path.join(this.config.paths.groupsDir, groupFolder, 'media');
        fs.mkdirSync(mediaDir, { recursive: true });
        const filePath = path.join(mediaDir, filename);
        fs.writeFileSync(filePath, buffer);

        this.logger.info({ groupFolder, type: mt.type, filename }, 'Media downloaded');

        // Extract thumbnail for video messages
        if (mt.key === 'videoMessage') {
          const thumbFilename = `${msg.key.id}-thumb.jpg`;
          const thumbPath = path.join(mediaDir, thumbFilename);
          const thumbResult = await this.extractThumbnail(
            filePath, thumbPath, mediaMsg.jpegThumbnail,
          );

          if (thumbResult) {
            const containerThumbPath = `/workspace/group/media/${thumbFilename}`;
            if (mediaMsg.gifPlayback) {
              // GIF: present thumbnail as image so the agent can view it
              this.logger.info({ groupFolder, filename: thumbFilename }, 'GIF thumbnail extracted as image');
              return { path: containerThumbPath, hostPath: thumbResult, type: 'image' };
            }
            // Regular video: include both video and thumbnail
            this.logger.info({ groupFolder, filename: thumbFilename }, 'Video thumbnail extracted');
            return {
              path: `/workspace/group/media/${filename}`,
              hostPath: filePath,
              type: 'video',
              thumbnailPath: containerThumbPath,
            };
          }
        }

        return { path: `/workspace/group/media/${filename}`, hostPath: filePath, type: mt.type };
      } catch (err) {
        this.logger.warn({ err, msgId: msg.key.id, type: mt.type }, 'Failed to download media');
      }
    }
    return null;
  }

  async disconnect() {
    this.shuttingDown = true;
    this.connected = false;
    this.sock?.end(undefined);
  }

  /**
   * Send typing indicator. Channel-interface contract is single-arg
   * (jid) — orchestrator polls every 4s while the agent is generating
   * and clears the interval when done, so each call means "still
   * composing". Default isTyping=true keeps the optional second arg as
   * an internal escape hatch.
   */
  async setTyping(jid, isTyping = true) {
    try {
      // Suppress 'composing' polls after the bot has just replied, until
      // the next inbound from this chat. Explicit setTyping(jid, false)
      // calls always pass through.
      if (isTyping && this.typingSuppressed.has(jid)) {
        return;
      }
      const status = isTyping ? 'composing' : 'paused';
      this.logger.debug({ jid, status }, 'Sending presence update');
      await this.sock.sendPresenceUpdate(status, jid);
    } catch (err) {
      this.logger.debug({ jid, err: err.message }, 'Failed to update typing status');
    }
  }

  /**
   * Public method to refresh group metadata.
   * Forces a re-sync regardless of the 24h cache.
   */
  async refreshMetadata() {
    return this.syncGroupMetadata(true);
  }

  /**
   * Sync group metadata from WhatsApp.
   * Fetches all participating groups and stores their names in the database.
   * Called on startup, daily, and on-demand via refreshMetadata.
   */
  async syncGroupMetadata(force = false) {
    if (!force) {
      const lastSync = this.config.db.getLastGroupSync();
      if (lastSync) {
        const lastSyncTime = new Date(lastSync).getTime();
        if (Date.now() - lastSyncTime < GROUP_SYNC_INTERVAL_MS) {
          this.logger.debug({ lastSync }, 'Skipping group sync - synced recently');
          return;
        }
      }
    }

    try {
      this.logger.info('Syncing group metadata from WhatsApp...');
      const groups = await this.sock.groupFetchAllParticipating();

      let count = 0;
      for (const [jid, metadata] of Object.entries(groups)) {
        if (metadata.subject) {
          this.config.db.updateChatName(jid, metadata.subject);
          count++;
        }
      }

      this.config.db.setLastGroupSync();
      this.logger.info({ count }, 'Group metadata synced');
    } catch (err) {
      this.logger.error({ err }, 'Failed to sync group metadata');
    }
  }

  /**
   * Fetch all participating groups from WhatsApp.
   * Returns an array of { jid, name } objects.
   */
  async listAvailableGroups() {
    const groups = await this.sock.groupFetchAllParticipating();
    return Object.entries(groups).map(([jid, metadata]) => ({
      jid,
      name: metadata.subject || jid,
    }));
  }

  /**
   * Update the LID→phone mapping. Centralised so all writes go through one
   * function — keeps the cache consistent with any side-effects (e.g. group
   * metadata invalidation in the upstream adapter).
   * @private
   */
  /**
   * Cache a sent message keyed by its WhatsApp id so getMessage can return
   * it on retry. Bounded by SENT_MESSAGE_CACHE_MAX (drop-oldest).
   * @private
   */
  rememberSentMessage(sent) {
    if (!sent?.key?.id || !sent.message) return;
    this.sentMessageCache.set(sent.key.id, sent.message);
    if (this.sentMessageCache.size > SENT_MESSAGE_CACHE_MAX) {
      const oldest = this.sentMessageCache.keys().next().value;
      if (oldest !== undefined) this.sentMessageCache.delete(oldest);
    }
  }

  setLidPhoneMapping(lidUser, phoneJid) {
    if (!lidUser || !phoneJid) return;
    if (this.lidToPhoneMap[lidUser] === phoneJid) return;
    this.lidToPhoneMap[lidUser] = phoneJid;
    this.logger.debug({ lidUser, phoneJid }, 'LID→phone mapping updated');
  }

  /** @private */
  async translateJid(jid) {
    if (!jid.endsWith('@lid')) return jid;
    const lidUser = jid.split('@')[0].split(':')[0];

    // Check local cache first
    const cached = this.lidToPhoneMap[lidUser];
    if (cached) {
      this.logger.debug({ lidJid: jid, phoneJid: cached }, 'Translated LID to phone JID (cached)');
      return cached;
    }

    // Query Baileys' signal repository for the mapping
    try {
      const pn = await this.sock.signalRepository?.lidMapping?.getPNForLID(jid);
      if (pn) {
        const phoneJid = `${pn.split('@')[0].split(':')[0]}@s.whatsapp.net`;
        this.setLidPhoneMapping(lidUser, phoneJid);
        this.logger.info({ lidJid: jid, phoneJid }, 'Translated LID to phone JID (signalRepository)');
        return phoneJid;
      }
    } catch (err) {
      this.logger.debug({ err, jid }, 'Failed to resolve LID via signalRepository');
    }

    return jid;
  }

  /** @private */
  async flushOutgoingQueue() {
    if (this.flushing || this.outgoingQueue.length === 0) return;
    this.flushing = true;
    try {
      this.logger.info({ count: this.outgoingQueue.length }, 'Flushing outgoing message queue');
      while (this.outgoingQueue.length > 0) {
        const item = this.outgoingQueue[0];
        const msg = { text: item.text };
        if (item.replyTo) {
          msg.quoted = { key: { remoteJid: item.jid, id: item.replyTo, fromMe: false } };
        }
        const sent = await this.sock.sendMessage(item.jid, msg);
        this.rememberSentMessage(sent);
        this.outgoingQueue.shift();
        this.logger.info({ jid: item.jid, length: item.text.length }, 'Queued message sent');
      }
    } finally {
      this.flushing = false;
    }
  }
}

export async function onChannel(ctx, config) {
  const channel = new WhatsAppChannel(config, ctx.logger);
  return channel;
}
