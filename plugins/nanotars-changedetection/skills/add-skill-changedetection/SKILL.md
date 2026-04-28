---
name: add-skill-changedetection
description: Add changedetection.io integration to NanoTars. Enables agents to create and manage website watches for price monitoring, stock alerts, and content changes. Guides through API key setup and webhook configuration. Triggers on "add changedetection", "changedetection setup", "price monitoring", "website monitoring".
---

# Add ChangeDetection.io

Configures changedetection.io API access for agent containers and sets up webhook notifications so changes trigger the agent automatically.

## Preflight

Before installing, verify NanoTars is set up:

```bash
[ -d node_modules ] && echo "DEPS: ok" || echo "DEPS: missing"
docker image inspect nanoclaw-agent:latest &>/dev/null && echo "IMAGE: ok" || echo "IMAGE: not built"
if grep -q "ANTHROPIC_API_KEY\|CLAUDE_CODE_OAUTH_TOKEN" .env 2>/dev/null || [ -f "$HOME/.claude/.credentials.json" ]; then echo "AUTH: ok"; else echo "AUTH: missing"; fi
```

If any check fails, tell the user to run `/nanotars-setup` first and stop.

## Prerequisites

- A running changedetection.io instance (self-hosted)
- NanoTars webhook server must be configured (`/add-skill-webhook`)

## Step 1: Check Existing Configuration

```bash
grep "^CHANGEDETECTION_URL=" .env 2>/dev/null && echo "URL_SET" || echo "NEED_URL"
grep "^CHANGEDETECTION_API_KEY=" .env 2>/dev/null && echo "KEY_SET" || echo "NEED_KEY"
grep "^NANOCLAW_WEBHOOK_SECRET=" .env 2>/dev/null && echo "WEBHOOK_SET" || echo "NEED_WEBHOOK"
ls plugins/changedetection/plugin.json 2>/dev/null && echo "PLUGIN_EXISTS" || echo "NO_PLUGIN"
```

If `NEED_WEBHOOK`, tell the user to run `/add-skill-webhook` first -- changedetection.io needs somewhere to send notifications.

If both URL and KEY are set, ask if they want to reconfigure.

## Step 2: Get Connection Details

Ask the user:
> Please provide your changedetection.io details:
> 1. **Instance URL** (e.g. `http://192.168.1.100:5000` or `https://cd.yourdomain.com`)
> 2. **API key** (found in Settings > API tab in the changedetection.io dashboard)

## Step 3: Save to .env

```bash
# Remove existing lines if present
sed -i '/^CHANGEDETECTION_URL=/d' .env
sed -i '/^CHANGEDETECTION_API_KEY=/d' .env

# Add the new values
echo 'CHANGEDETECTION_URL=THE_URL_HERE' >> .env
echo 'CHANGEDETECTION_API_KEY=THE_KEY_HERE' >> .env
```

## Step 4: Install Plugin

```bash
cp -r ${CLAUDE_PLUGIN_ROOT}/files/ plugins/changedetection/
```

## Step 5: Plugin Configuration

Ask the user which groups should have access to this plugin:
- **All groups** (default) -- every group's agent can use this
- **Specific groups only** -- e.g., only `main`

If restricting, update `plugins/changedetection/plugin.json` to set `"groups"` to the list of group folder names.

Also ask about channel types. Leave `"channels": ["*"]` for all, or set to specific types (e.g., `["whatsapp"]`).

## Step 6: Test the Connection

```bash
source .env
curl -s "${CHANGEDETECTION_URL}/api/v1/watch" \
  -H "x-api-key: ${CHANGEDETECTION_API_KEY}" | python3 -c "
import sys, json
r = json.load(sys.stdin)
if isinstance(r, dict):
    print(f'OK - {len(r)} watch(es) found')
else:
    print(f'FAILED - unexpected response: {str(r)[:200]}')
"
```

If the test fails:
- **Connection refused**: Check the URL and that changedetection.io is running
- **401/403**: API key is wrong -- regenerate in Settings > API
- **Timeout**: Check network/firewall between NanoTars and changedetection.io

## Step 7: Test Webhook Connectivity

Verify changedetection.io can reach NanoTars's webhook endpoint:

```bash
source .env
SECRET=$(grep "^NANOCLAW_WEBHOOK_SECRET=" .env | cut -d= -f2)
curl -s -X POST http://localhost:3457/webhook \
  -H "Authorization: Bearer ${SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"source": "changedetection-test", "text": "Test notification from changedetection.io setup"}' | python3 -c "
import sys, json
r = json.load(sys.stdin)
if r.get('ok'):
    print('OK - webhook endpoint reachable')
else:
    print(f'FAILED - {r}')
"
```

## Step 8: Build and Restart

```bash
npm run build
nanotars restart  # or launchctl on macOS
```

## Verify

Ask the agent to:
- "Monitor this product page for price changes: [URL]"
- "Show me all active changedetection watches"

When a watched page changes, changedetection.io will webhook NanoTars and the agent will notify you automatically.

## Existing Installation (Per-Group Credentials)

If this plugin is already installed and you want **different credentials for a specific group** (e.g., a work account for one group, personal for another):

1. Check which groups exist:
   ```bash
   ls -d groups/*/
   ```

2. Ask the user which group should get separate credentials.

3. Collect the new ChangeDetection credentials for that group.

4. Write to the group's `.env` file (creates if needed):
   ```bash
   echo 'CHANGEDETECTION_URL=https://other-cd.example.com' >> groups/{folder}/.env
   echo 'CHANGEDETECTION_API_KEY=api-key' >> groups/{folder}/.env
   ```
   These values override the global `.env` for that group's containers only.

5. Restart NanoTars:
   ```bash
   nanotars restart
   ```

## Remove

1. `rm -rf plugins/changedetection/`
2. Remove env vars from .env:
   ```bash
   sed -i '/^CHANGEDETECTION_URL=/d' .env
   sed -i '/^CHANGEDETECTION_API_KEY=/d' .env
   ```
3. Rebuild and restart
