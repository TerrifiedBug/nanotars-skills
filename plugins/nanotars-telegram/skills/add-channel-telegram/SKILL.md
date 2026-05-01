---
name: add-channel-telegram
description: Add Telegram as a channel. Can replace WhatsApp entirely or run alongside it. Also configurable as a control-only channel (triggers actions) or passive channel (receives notifications only).
---

# Add Telegram Channel

This skill installs the Telegram channel plugin and guides through authentication.
It also supports additional Telegram bot instances, such as
`telegram-personal`, when one operator needs multiple Telegram DMs under
different bot tokens.

## Preflight

Before installing, verify NanoTars is set up:

```bash
[ -d node_modules ] && echo "DEPS: ok" || echo "DEPS: missing"
docker image inspect nanoclaw-agent:latest &>/dev/null && echo "IMAGE: ok" || echo "IMAGE: not built"
if grep -q "ANTHROPIC_API_KEY\|CLAUDE_CODE_OAUTH_TOKEN" .env 2>/dev/null || [ -f "$HOME/.claude/.credentials.json" ]; then echo "AUTH: ok"; else echo "AUTH: missing"; fi
```

If any check fails, tell the user to run `/nanotars-setup` first and stop.

## Step 1: Install Plugin

Choose the channel instance name:

- Use `telegram` for the first/default Telegram bot.
- Use a unique lowercase dash name for additional bots, for example
  `telegram-personal` or `telegram-family`.

The plugin directory must match the channel instance name. Check if
`plugins/channels/<instance>/` exists. If not, copy from skill template files:

```bash
mkdir -p plugins/channels/telegram
cp -r ${CLAUDE_PLUGIN_ROOT}/files/* plugins/channels/telegram/
```

For an additional instance, copy into that instance directory and update the
manifest name and token env key. Example for `telegram-personal`:

```bash
mkdir -p plugins/channels/telegram-personal
cp -r ${CLAUDE_PLUGIN_ROOT}/files/* plugins/channels/telegram-personal/
node -e "const fs=require('fs'); const p='plugins/channels/telegram-personal/plugin.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.name='telegram-personal'; j.containerEnvVars=['TELEGRAM_PERSONAL_BOT_TOKEN']; j.telegramBotTokenEnv='TELEGRAM_PERSONAL_BOT_TOKEN'; j.telegramBotPoolEnv='TELEGRAM_PERSONAL_BOT_POOL'; fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n');"
```

Then install dependencies:

```bash
cd plugins/channels/<instance> && npm install && cd -
```

## Step 2: Authenticate

### Create a Bot

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` and follow prompts:
   - Bot name: Something friendly (e.g., "TARS Assistant")
   - Bot username: Must end with "bot" (e.g., "andy_ai_bot")
3. Copy the bot token (looks like `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)

### Authenticate

Run the plugin auth script. It validates the token with Telegram, writes it to
`.env`, and stores auth status under `data/channels/<instance>/`.

```bash
nanotars auth <instance>
```

For non-interactive setup:

```bash
nanotars auth <instance> --token YOUR_BOT_TOKEN_HERE
```

Default instance token env: `TELEGRAM_BOT_TOKEN`.
Additional instance token env: derived from the instance name, for example
`TELEGRAM_PERSONAL_BOT_TOKEN` for `telegram-personal`.

### Disable Group Privacy (for group chats)

By default, Telegram bots in groups only receive messages that @mention the bot or are commands. To let the bot see all messages:

1. Open `@BotFather`
2. Send `/mybots` and select your bot
3. Go to **Bot Settings** > **Group Privacy** > **Turn off**

Optional if the user only wants trigger-based responses via @mentioning the bot.

## Step 3: Build and Restart

```bash
npm run build
```

Then restart the service (systemd or launchd depending on platform).

## Step 4: Register a Chat

Use `/chatid` command in any Telegram chat with the bot to get the chat ID.

- **Private chat**: `tg:123456789` (positive number)
- **Group chat**: `tg:-1001234567890` (negative number)
- **Additional bot instance**: `telegram-personal:123456789`

Register the main group (there can only be one) via `/nanotars-setup`. Add additional groups with `/nanotars-add-group`.

For channel migrations, use the instance name as the destination channel. Example:

```bash
nanotars migrate-channel whatsapp-danny --from-channel whatsapp --to-channel telegram-personal --apply
```

Then send the pairing code to the new Telegram bot. Do not migrate a second
chat to the default `telegram` instance if the same Telegram user is already
paired there and you need an independent DM; create a second bot instance.

## Trigger Behavior

The bot responds when:
1. Chat has `requiresTrigger: false` (e.g., main group)
2. Bot is @mentioned in Telegram (auto-translated to trigger pattern)
3. Message matches trigger pattern directly (e.g., starts with @TARS)

## Agent Swarm Support

After completing setup, ask the user if they want Agent Swarm (Teams) support. If yes, invoke `/add-skill-telegram-swarm`.

The plugin has built-in bot pool support for agent teams. Each subagent appears as a different bot identity in Telegram.

To enable for the default instance, create 3-5 additional bots via @BotFather
and set:

```bash
TELEGRAM_BOT_POOL=TOKEN1,TOKEN2,TOKEN3
```

For an additional instance, use the derived pool env key, for example:

```bash
TELEGRAM_PERSONAL_BOT_POOL=TOKEN1,TOKEN2,TOKEN3
```

Pool bots are send-only (no polling). When a subagent calls `send_message` with a `sender` parameter, the host assigns a pool bot and renames it to match the sender's role. See `/add-skill-telegram-swarm` for full setup guide.

## Commands

- `/chatid` — Get chat ID for registration
- `/ping` — Check if bot is online

## Troubleshooting

### Bot not responding

1. Verify the instance token env is set in `.env`
2. Check chat is registered: run `/nanotars-groups` to list registered groups (don't query the SQLite schema directly — it migrated to the entity model in 2026-04 and inline SQL silently breaks)
3. For non-main chats: ensure message includes trigger pattern
4. Check service is running

### Bot only responds to @mentions in groups

Group Privacy is enabled (default). Fix:
1. Open `@BotFather` > `/mybots` > select bot > **Bot Settings** > **Group Privacy** > **Turn off**
2. Remove and re-add the bot to the group (required for the change to take effect)

### Verifying bot token

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"
```

## Uninstall

1. Stop NanoTars
2. Remove group registrations: use `/nanotars-remove-plugin` for a guided removal, or the operator delete-group flow — do not reach into the SQLite schema directly
3. Remove plugin: `rm -rf plugins/channels/telegram/`
4. Remove the instance token and pool env vars from `.env`
5. Restart NanoTars
