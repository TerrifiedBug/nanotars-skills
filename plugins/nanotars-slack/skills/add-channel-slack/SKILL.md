---
name: add-channel-slack
description: Add Slack as a messaging channel. Uses Socket Mode (no public URL needed). Triggers on "add slack", "slack setup", "slack channel".
---

# Add Slack Channel

This skill installs the Slack channel plugin and guides through authentication.

## Preflight

Before installing, verify NanoTars is set up:

```bash
[ -d node_modules ] && echo "DEPS: ok" || echo "DEPS: missing"
docker image inspect nanoclaw-agent:latest &>/dev/null && echo "IMAGE: ok" || echo "IMAGE: not built"
if grep -q "ANTHROPIC_API_KEY\|CLAUDE_CODE_OAUTH_TOKEN" .env 2>/dev/null || [ -f "$HOME/.claude/.credentials.json" ]; then echo "AUTH: ok"; else echo "AUTH: missing"; fi
```

If any check fails, tell the user to run `/nanotars-setup` first and stop.

## Step 1: Install Plugin

Check if `plugins/channels/slack/` exists. If not, copy from skill template files:

```bash
mkdir -p plugins/channels/slack
cp -r ${CLAUDE_PLUGIN_ROOT}/files/* plugins/channels/slack/
```

Then install dependencies:

```bash
cd plugins/channels/slack && npm install && cd -
```

## Step 2: Create Slack App

Walk the user through creating a Slack App:

### 2a. Create the App

1. Go to https://api.slack.com/apps
2. Click **Create New App** > **From scratch**
3. Name it (e.g., "TARS", "NanoTars Bot")
4. Select the workspace to install to

### 2b. Enable Socket Mode

1. Go to **Settings** > **Socket Mode** in the left sidebar
2. Toggle **Enable Socket Mode** to On
3. Give the app-level token a name (e.g., "socket-token")
4. Under scopes, ensure `connections:write` is selected
5. Click **Generate** — copy the `xapp-...` token

### 2c. Add Bot Scopes

Go to **OAuth & Permissions** > **Bot Token Scopes** and add:

**Required scopes:**
- `channels:history` — Read messages in public channels
- `channels:read` — View channel info
- `chat:write` — Send messages
- `files:read` — Access shared files
- `files:write` — Upload files
- `groups:history` — Read messages in private channels
- `groups:read` — View private channel info
- `im:history` — Read DMs
- `im:read` — View DM info
- `mpim:history` — Read group DMs
- `reactions:write` — Add emoji reactions
- `users:read` — View user display names

**Optional (recommended for Agent Teams):**
- `chat:write.customize` — Send messages with custom display names

### 2d. Subscribe to Events

Go to **Event Subscriptions**:
1. Toggle **Enable Events** to On
2. Under **Subscribe to bot events**, add:
   - `message.channels`
   - `message.groups`
   - `message.im`
   - `message.mpim`

### 2e. Install to Workspace

1. Go to **Install App** in the sidebar
2. Click **Install to Workspace** and authorize
3. Copy the **Bot User OAuth Token** (`xoxb-...`)

## Step 3: Set Environment Variables

Add both tokens to `.env`:

```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
```

Sync to container environment:

```bash
cp .env data/env/env
```

## Step 4: Invite Bot to Channels

The bot can only see messages in channels it's been invited to.

In each Slack channel where you want the bot:
1. Type `/invite @YourBotName`
2. Or click the channel name > **Integrations** > **Add an App**

## Step 5: Build and Restart

```bash
npm run build
```

Then restart the service (systemd or launchd depending on platform).

## Step 6: Register a Channel

Use `/nanotars-add-group` to register a Slack channel. The plugin provides `listAvailableGroups()` which shows all channels the bot has been invited to.

Channel IDs look like: `slack:C01ABC123` (public), `slack:G01ABC123` (private), `slack:D01ABC123` (DM)

## Trigger Behavior

The bot responds when:
1. Chat has `requiresTrigger: false` (e.g., main group — responds to all messages)
2. Bot is @mentioned in Slack (auto-translated to trigger pattern)
3. User replies in a thread started by the bot (reply-to-bot triggering)

## Troubleshooting

### Bot not connecting

1. Verify both `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` are set in `.env`
2. Confirm Socket Mode is enabled in app settings
3. Check logs: `tail -20 logs/nanotars.log | grep -i slack`

### Bot not receiving messages

1. Verify event subscriptions are configured (message.channels, etc.)
2. Confirm bot is invited to the channel (`/invite @BotName`)
3. For private channels: ensure `groups:history` scope is added

### Bot can't send messages

1. Verify `chat:write` scope is added
2. Confirm bot is a member of the target channel

### Agent team names not showing

Add the `chat:write.customize` scope in OAuth & Permissions, then reinstall the app to the workspace.

### Verifying bot token

```bash
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" https://slack.com/api/auth.test | python3 -m json.tool
```

## Uninstall

Use `/nanotars-remove-plugin` for a guided removal — it stops the service, removes the plugin directory, cleans up channel data, and removes registered-group entries via the proper IPC primitives. Manual steps if needed:

1. `nanotars stop`
2. From your main chat (before stopping), run `/delete-group <folder>` for each Slack-wired group you want to remove. Skip this if you want the agent_group rows preserved for re-wiring to a different channel.
3. `rm -rf plugins/channels/slack/`
4. Remove `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` from `.env`
5. `nanotars restart` — group folders and message history are preserved.
