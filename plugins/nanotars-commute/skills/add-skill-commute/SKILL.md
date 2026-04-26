---
name: add-skill-commute
description: Add travel time and commute lookup to NanoClaw agents using Waze live traffic data. No API key needed. Triggers on "add commute", "commute setup", "travel time", "waze".
---

# Add Commute

Adds live traffic-based travel time lookups using the Waze routing API (no API key required).

## Preflight

Before installing, verify NanoClaw is set up:

```bash
[ -d node_modules ] && echo "DEPS: ok" || echo "DEPS: missing"
docker image inspect nanoclaw-agent:latest &>/dev/null && echo "IMAGE: ok" || echo "IMAGE: not built"
(grep -q "ANTHROPIC_API_KEY\|CLAUDE_CODE_OAUTH_TOKEN" .env 2>/dev/null || [ -f ~/.claude/.credentials.json ]) && echo "AUTH: ok" || echo "AUTH: missing"
```

If any check fails, tell the user to run `/nanotars-setup` first and stop.

## Install

1. Copy plugin files:
   ```bash
   cp -r ${CLAUDE_PLUGIN_ROOT}/files/ plugins/commute/
   ```
2. **Plugin Configuration:** By default this plugin is available to all groups and channel types. To restrict access, edit `plugins/commute/plugin.json` and set:
   - `"groups"` to specific group folder names (e.g., `["main"]`) instead of `["*"]`
   - `"channels"` to specific channel types (e.g., `["whatsapp"]`) instead of `["*"]`

   Ask the user if they want to restrict access. Most users will keep the defaults.
3. Rebuild and restart:
   ```bash
   npm run build
   systemctl --user restart nanotars  # or launchctl on macOS
   ```

## Verify

Ask the agent "how long to drive from Oxford to London?" -- it should use the Waze API to get live traffic times.

## Remove

1. ```bash
   rm -rf plugins/commute/
   ```
2. Rebuild and restart
