---
name: add-channel-whatsapp
description: >
  Add WhatsApp as a channel. Install the WhatsApp channel plugin and authenticate.
  Use when WhatsApp is not already installed as a core plugin.
  Triggers on "add whatsapp", "whatsapp setup", "whatsapp channel".
---

# Add WhatsApp Channel

Adds WhatsApp as a messaging channel to NanoClaw using the Baileys library.

## Preflight

Before installing, verify NanoClaw is set up:

```bash
[ -d node_modules ] && echo "DEPS: ok" || echo "DEPS: missing"
docker image inspect nanoclaw-agent:latest &>/dev/null && echo "IMAGE: ok" || echo "IMAGE: not built"
(grep -q "ANTHROPIC_API_KEY\|CLAUDE_CODE_OAUTH_TOKEN" .env 2>/dev/null || [ -f ~/.claude/.credentials.json ]) && echo "AUTH: ok" || echo "AUTH: missing"
```

If any check fails, tell the user to run `/nanotars-setup` first and stop.

## Prerequisites

- A phone number with WhatsApp installed (for QR code authentication)

## Install

1. Check current state:
   ```bash
   [ -d plugins/channels/whatsapp ] && echo "PLUGIN_EXISTS" || echo "NEED_PLUGIN"
   ```
   If plugin exists, skip to Auth.

2. Copy channel plugin files into place:
   ```bash
   mkdir -p plugins/channels/whatsapp
   cp -r ${CLAUDE_PLUGIN_ROOT}/files/* plugins/channels/whatsapp/
   ```

3. The plugin has `"dependencies": true` in its manifest, so the plugin-loader will run `npm install` automatically on first startup. To install dependencies now:
   ```bash
   cd plugins/channels/whatsapp && npm install && cd -
   ```

4. Rebuild and restart:
   ```bash
   npm run build
   ```

   Then restart the service:
   ```bash
   systemctl --user restart nanotars 2>/dev/null || launchctl kickstart -k gui/$(id -u)/com.nanotars 2>/dev/null || echo "Restart the NanoClaw service manually"
   ```

## Auth

### Status file conventions

The auth script writes its progress to `data/channels/whatsapp/auth-status.txt`:
- `already_authenticated` — credentials exist; nothing to do
- `pairing_code:<CODE>` — pairing code issued, waiting for the user to enter it
- `authenticated` — paired successfully
- `failed:<reason>` — auth failed (e.g. `failed:qr_timeout`, `failed:logged_out`)

When a QR is needed, the script also writes:
- `data/channels/whatsapp/qr-data.txt` — raw QR ref string (used by `--serve` HTTP fallback)
- `data/channels/whatsapp/qr-data.png` — 400px PNG, **render this inline with the Read tool**

Error 515 (stream error after pairing) is handled internally by automatic reconnect — normal during pairing-code auth.

### Ask the user which method to use

> How would you like to authenticate WhatsApp?
>
> 1. **QR code** (Recommended) — I'll display a scannable QR right here in this session
> 2. **Pairing code** — Enter a numeric code on your phone, no camera needed

### Option A: QR Code (recommended)

Clean any stale auth state and start the auth flow in the background:

```bash
rm -rf data/channels/whatsapp/auth data/channels/whatsapp/qr-data.* data/channels/whatsapp/auth-status.txt
nanotars auth whatsapp
```

If `nanotars auth whatsapp` is not yet available on this install (older wrapper without the `auth` subcommand), fall back to the explicit invocation:

```bash
node plugins/channels/whatsapp/auth.js
```

Run with `run_in_background: true`.

Poll for the QR PNG (up to 20 seconds — `fetchLatestWaWebVersion` adds a few seconds before the QR appears):

```bash
for i in $(seq 1 20); do
  if [ -f data/channels/whatsapp/qr-data.png ]; then echo "qr_ready"; exit 0; fi
  STATUS=$(cat data/channels/whatsapp/auth-status.txt 2>/dev/null || echo "waiting")
  if [ "$STATUS" = "already_authenticated" ]; then echo "$STATUS"; exit 0; fi
  if echo "$STATUS" | grep -q "^failed:"; then echo "$STATUS"; exit 0; fi
  sleep 1
done
echo "timeout"
```

If `already_authenticated`, skip to "Register a Chat".

If `qr_ready`, render the QR inline by **using the Read tool** on `data/channels/whatsapp/qr-data.png`. Claude Code's Read tool is multimodal — the QR image will appear directly in this session for the user to scan.

Tell the user:
> The QR code is ready (above). It expires in about 60 seconds.
>
> Scan it with WhatsApp: **Settings > Linked Devices > Link a Device**

Then poll for completion (up to 120 seconds):

```bash
for i in $(seq 1 60); do
  STATUS=$(cat data/channels/whatsapp/auth-status.txt 2>/dev/null || echo "waiting")
  if [ "$STATUS" = "authenticated" ] || [ "$STATUS" = "already_authenticated" ]; then echo "$STATUS"; exit 0; fi
  if echo "$STATUS" | grep -q "^failed:"; then echo "$STATUS"; exit 0; fi
  sleep 2
done
echo "timeout"
```

- `authenticated` → success, continue.
- `failed:qr_timeout` → QR expired before scan, offer to retry.
- `failed:logged_out` → delete `data/channels/whatsapp/auth/` and retry.
- `failed:405` → indicates the WA Web version pin failed; the auth script already calls `fetchLatestWaWebVersion`, but if WA's CDN was unreachable Baileys' default is used. Wait a minute and retry, or check network egress to `web.whatsapp.com`.

### Option B: Pairing Code

Ask the user for their phone number (with country code, no `+` or spaces, e.g. `14155551234`).

```bash
rm -rf data/channels/whatsapp/auth data/channels/whatsapp/qr-data.* data/channels/whatsapp/auth-status.txt
nanotars auth whatsapp --pairing-code --phone PHONE_NUMBER
```

Fallback for installs without the `auth` subcommand:

```bash
node plugins/channels/whatsapp/auth.js --pairing-code --phone PHONE_NUMBER
```

Run with `run_in_background: true`.

Poll for the pairing code (up to 20 seconds):

```bash
for i in $(seq 1 20); do
  STATUS=$(cat data/channels/whatsapp/auth-status.txt 2>/dev/null || echo "waiting")
  if echo "$STATUS" | grep -q "^pairing_code:"; then echo "$STATUS"; exit 0; fi
  if [ "$STATUS" = "authenticated" ] || [ "$STATUS" = "already_authenticated" ]; then echo "$STATUS"; exit 0; fi
  if echo "$STATUS" | grep -q "^failed:"; then echo "$STATUS"; exit 0; fi
  sleep 1
done
echo "timeout"
```

Extract the code from the status (e.g. `pairing_code:ABC12DEF` → `ABC12DEF`) and tell the user:

> Your pairing code: **CODE_HERE**
>
> 1. Open WhatsApp on your phone
> 2. Tap **Settings > Linked Devices > Link a Device**
> 3. Tap **"Link with phone number instead"**
> 4. Enter the code: **CODE_HERE** (you have ~60 seconds)

Then poll for completion (same loop as Option A's completion poll above).

- `authenticated` → success, continue.
- `failed:logged_out` → delete `data/channels/whatsapp/auth/` and retry.
- `failed:515` or timeout → the 515 auto-reconnect should handle this; if it persists, temporarily stop other WhatsApp-linked apps on the same device.

### Headless / external-device fallback (`--serve`)

If the user wants to scan from a different device than the one running the agent, the auth script can serve the QR as a webpage:

```bash
nanotars auth whatsapp --serve
# or: node plugins/channels/whatsapp/auth.js --serve
```

Tell the user to open `http://SERVER_IP:8899` in a browser. The page long-polls for QR rotation automatically.

## Agent Teams

WhatsApp supports Agent Teams out of the box — no extra setup needed (unlike Telegram, which requires a bot pool). When subagents specify a `sender` parameter, their messages appear with a bold name prefix:

```
TARS: *Research Specialist*
Here's what I found...
```

To add persistent agent definitions to a group, run `/nanotars-add-agent`.

## Register a Chat

After authentication, the main chat is registered by `/nanotars-setup` (section 6c). Additional groups can be added later with `/nanotars-add-group`.

### WhatsApp JID Formats

| Type | Format | Example |
|------|--------|---------|
| Group | `{id}@g.us` | `120363336345536173@g.us` |
| Personal/DM | `{phone}@s.whatsapp.net` | `14155551234@s.whatsapp.net` |

### Finding Groups

Use `/nanotars-add-group` after auth — it lists available WhatsApp groups via the live Baileys connection (`sock.groupFetchAllParticipating()`) and walks through registration. To inspect already-registered groups, run `/nanotars-groups`.

### Finding Personal Chat JID

The "Message Yourself" JID is the bot's own phone number. After auth completes, the plugin's runtime adapter logs the bot's user id; check `tail logs/nanotars.log | grep -i 'connected to whatsapp'`. The JID format is `{phone}@s.whatsapp.net`.

## Verify

- Check logs: `tail -20 logs/nanotars.log | grep -i whatsapp`
- Send a test message in the registered WhatsApp chat and confirm the agent responds

## Troubleshooting

- **Error 405 / "Connection failed" before QR appears**: The auth script's WA Web version pin (`fetchLatestWaWebVersion`) couldn't reach `web.whatsapp.com`. Check network egress, wait a minute, retry.
- **Error 515 "restart required"**: Normal during initial pairing — the auth script auto-reconnects. If it persists, temporarily stop other WhatsApp-connected apps on the same device. Wait 30 seconds.
- **QR code too wide for terminal**: Use the inline-PNG flow (Option A above — Read the PNG instead of the terminal output) or `--serve` for an HTTP-served QR at `http://SERVER_IP:8899`.
- **Messages sent but not received (DMs)**: WhatsApp may use LID (Linked Identity) JIDs for DMs instead of phone numbers. Check logs for `Translated LID to phone JID`. The plugin handles this automatically via `translateJid`.
- **Messages not received from a registered group**: Run `/nanotars-groups` to confirm the group is registered and active. Don't reach into the database directly — schema migrations have moved registered-group state into the entity model (`agent_groups` / `messaging_groups` / `messaging_group_agents`).
- **WhatsApp disconnected after working previously**: The service logs an error and exits. Run `nanotars auth whatsapp` (or `node plugins/channels/whatsapp/auth.js`) to re-authenticate, then `nanotars restart`.

## Uninstall

Use `/nanotars-remove-plugin` for a guided removal — it stops the service, removes the plugin directory, cleans up channel data, and removes registered-group entries via the proper IPC primitives. Manual steps if needed:

1. `nanotars stop`
2. `rm -rf plugins/channels/whatsapp/`
3. `rm -rf data/channels/whatsapp/`
4. Removal of registered-group entries → use `/nanotars-remove-plugin` or the operator delete-group flow (do not reach into the SQLite schema directly).
5. `nanotars restart`
6. Group folders under `groups/` are preserved.
