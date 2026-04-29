---
name: add-skill-transcription
description: Add voice message transcription to NanoTars using OpenAI's Whisper API. Automatically transcribes voice notes so the agent can read and respond to them. Triggers on "add transcription", "voice transcription", "whisper", "transcribe voice".
---

# Add Voice Transcription

Automatic voice message transcription via OpenAI's Whisper API. When users send voice notes on any channel (WhatsApp, Telegram, Discord), the transcription hook converts them to text before the agent sees the message.

Works with any channel plugin that sets `mediaType='audio'` and `mediaHostPath` on inbound messages.

## Preflight

Before installing, verify NanoTars is set up:

```bash
[ -d node_modules ] && echo "DEPS: ok" || echo "DEPS: missing"
docker image inspect nanoclaw-agent:latest &>/dev/null && echo "IMAGE: ok" || echo "IMAGE: not built"
if grep -q "ANTHROPIC_API_KEY\|CLAUDE_CODE_OAUTH_TOKEN" .env 2>/dev/null || [ -f "$HOME/.claude/.credentials.json" ]; then echo "AUTH: ok"; else echo "AUTH: missing"; fi
```

If any check fails, tell the user to run `/nanotars-setup` first and stop.

## Prerequisites

- At least one channel plugin installed with voice/audio support

## Step 1: Check Existing Configuration

```bash
grep "^OPENAI_API_KEY=" .env 2>/dev/null && echo "KEY_SET" || echo "KEY_MISSING"
[ -d plugins/transcription ] && echo "PLUGIN_EXISTS" || echo "PLUGIN_MISSING"
```

If already configured, ask the user if they want to reconfigure or just verify.

## Step 2: Get OpenAI API Key

**Use the AskUserQuestion tool** to present this:

> You'll need an OpenAI API key for Whisper transcription.
>
> Get one at: https://platform.openai.com/api-keys
>
> Cost: ~$0.006 per minute of audio (~$0.003 per typical 30-second voice note)

Wait for user to provide their API key.

## Step 3: Save to .env

```bash
# Remove existing line if present
sed -i '/^OPENAI_API_KEY=/d' .env

# Add the new key
echo "OPENAI_API_KEY=THE_KEY_HERE" >> .env
```

## Step 4: Install Plugin

```bash
cp -r ${CLAUDE_PLUGIN_ROOT}/files/ plugins/transcription/
```

The plugin has `"dependencies": true` in its manifest, so the plugin-loader will run `npm install` automatically on next startup. Installing now is faster and surfaces install errors immediately:

```bash
cd plugins/transcription && npm install && cd -
```

## Step 5: Plugin Configuration

By default this plugin is available to all groups and channel types. To restrict access, edit `plugins/transcription/plugin.json` and set:
- `"groups"` to specific group folder names (e.g., `["main"]`) instead of `["*"]`
- `"channels"` to specific channel types (e.g., `["whatsapp"]`) instead of `["*"]`

Ask the user if they want to restrict access. Most users will keep the defaults.

## Step 6: Build and Restart

```bash
npm run build
nanotars restart  # or launchctl on macOS
```

## Verify

Tell the user:
> Voice transcription is ready! Test it by sending a voice note in any registered chat.
>
> Voice messages appear to the agent as: `[Voice: <transcribed text>]`

Watch for transcription in the logs:
```bash
tail -f logs/nanotars.log | grep -i "voice\|transcri"
```

## Troubleshooting

- **"transcription unavailable"**: Check `OPENAI_API_KEY` is set in `.env` and has credits
- **Voice messages not detected**: Ensure you're sending voice notes, not audio file attachments
- **No transcription on a channel**: That channel plugin may not set `mediaType`/`mediaHostPath` on audio messages

**Per-group credential overrides:** Not applicable. Transcription is a system-wide service that processes all inbound audio.

## Remove

1. `rm -rf plugins/transcription/`
2. Remove env var: `sed -i '/^OPENAI_API_KEY=/d' .env`
3. Rebuild and restart
