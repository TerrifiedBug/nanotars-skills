---
name: add-skill-parcels
description: Add parcel delivery tracking to NanoTars agents via parcelapp.net's API. Enables on-demand "where's my parcel" queries plus inclusion in the morning digest. Requires a Parcel app subscription (the API key is granted via the iOS / macOS Parcel app). Triggers on "add parcels", "add parcel tracking", "parcel skill", "delivery tracking".
---

# Add Parcels skill

Configures Parcel delivery-tracking API access for agent containers. Uses [parcelapp.net](https://parcelapp.net/)'s read-only API.

## Preflight

Before installing, verify NanoTars is set up:

```bash
[ -d node_modules ] && echo "DEPS: ok" || echo "DEPS: missing"
docker image inspect nanoclaw-agent:latest &>/dev/null && echo "IMAGE: ok" || echo "IMAGE: not built"
if grep -q "ANTHROPIC_API_KEY\|CLAUDE_CODE_OAUTH_TOKEN" .env 2>/dev/null || [ -f "$HOME/.claude/.credentials.json" ]; then echo "AUTH: ok"; else echo "AUTH: missing"; fi
```

If any check fails, tell the user to run `/nanotars-setup` first and stop.

## Prerequisites

- A **Parcel app** subscription (the iOS / macOS app at https://parcelapp.net/) — the API key is generated from inside the app.
- Free tier of the Parcel app does NOT include API access; you need the paid Premium tier.

## Install

1. **Get the API key:**
   - Open the Parcel app on iOS or macOS
   - Go to **Settings → Premium → API Access**
   - Tap **Generate API Key** (or copy the existing one)
   - Note the rate limit: **20 requests/hour**

2. **Copy plugin files into place:**
   ```bash
   cp -r ${CLAUDE_PLUGIN_ROOT}/files/ plugins/parcels/
   ```

3. **Plugin configuration:** by default this plugin is available to all groups and channels. To restrict access, edit `plugins/parcels/plugin.json` and set:
   - `"groups"` to specific group folder names (e.g. `["main"]`) instead of `["*"]`
   - `"channels"` to specific channel types (e.g. `["whatsapp"]`) instead of `["*"]`
   Most users keep the defaults.

4. **Add the API key to `.env`:**
   ```bash
   echo 'PARCEL_API_KEY=YOUR_KEY_HERE' >> .env
   ```

5. **Restart:**
   ```bash
   nanotars restart
   ```

## Verify

Send a quick query in your registered chat: "any parcels coming?" or "check my deliveries". The agent should run the helper script and reply with active deliveries + the latest tracking event for each.

To test the script directly inside the container:

```bash
docker exec -i $(docker ps --filter name=nanoclaw- --format '{{.Names}}' | head -1) \
  python3 /workspace/.claude/skills/parcels/scripts/parcel_api.py active
```

## Troubleshooting

- **`PARCEL_API_KEY is not set`** → re-check `.env` has the line and `nanotars restart` has been run since.
- **HTTP 401 / 403** → key is wrong, expired, or revoked. Re-generate from the Parcel app's API Access settings.
- **HTTP 429 / rate-limited** → 20 req/hour cap. Avoid scheduled polling beyond once-per-digest; trigger on demand for ad-hoc queries.
- **Empty deliveries list** → nothing currently active or recent. Try the `recent` filter for broader history.
- **Carrier code shows as a slug** → run with `--include-carriers` to resolve to friendly carrier names.

## Uninstall

1. `nanotars stop`
2. `rm -rf plugins/parcels/`
3. Remove `PARCEL_API_KEY` from `.env`
4. `nanotars restart`
