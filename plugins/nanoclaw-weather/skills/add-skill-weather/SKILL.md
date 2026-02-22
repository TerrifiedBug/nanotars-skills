---
name: add-skill-weather
description: Add weather lookup capability to NanoClaw agents. Uses free wttr.in and Open-Meteo APIs — no API key needed. Triggers on "add weather", "weather setup", "weather skill".
---

# Add Weather

Adds weather forecast capability to NanoClaw agents using free public APIs (no API key required).

## Preflight

Before installing, verify NanoClaw is set up:

```bash
[ -d node_modules ] && echo "DEPS: ok" || echo "DEPS: missing"
docker image inspect nanoclaw-agent:latest &>/dev/null && echo "IMAGE: ok" || echo "IMAGE: not built"
(grep -q "ANTHROPIC_API_KEY\|CLAUDE_CODE_OAUTH_TOKEN" .env 2>/dev/null || [ -f ~/.claude/.credentials.json ]) && echo "AUTH: ok" || echo "AUTH: missing"
```

If any check fails, tell the user to run `/nanoclaw-setup` first and stop.

## Install

1. Copy plugin files:
   ```bash
   cp -r ${CLAUDE_PLUGIN_ROOT}/files/ plugins/weather/
   ```
2. **Plugin Configuration:** By default this plugin is available to all groups and channel types. To restrict access, edit `plugins/weather/plugin.json` and set:
   - `"groups"` to specific group folder names (e.g., `["main"]`) instead of `["*"]`
   - `"channels"` to specific channel types (e.g., `["whatsapp"]`) instead of `["*"]`

   Ask the user if they want to restrict access. Most users will keep the defaults.
3. Rebuild and restart:
   ```bash
   npm run build
   systemctl restart nanoclaw  # or launchctl on macOS
   ```

## Verify

Ask the agent about the weather in any city.

## Remove

1. ```bash
   rm -rf plugins/weather/
   ```
2. Rebuild and restart
