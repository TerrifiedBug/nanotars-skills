---
name: add-skill-slack-formatting
description: Add Slack mrkdwn formatting guidance to Nanotars agents. Drop-in container skill that teaches agents to use Slack's mrkdwn syntax instead of standard Markdown when posting to Slack channels. Triggers on "add slack formatting", "slack mrkdwn", "format for slack".
---

# Add Slack Formatting

Adds a container skill that teaches agents to use Slack's mrkdwn syntax (`*bold*`, `<url|text>`, `•` bullets) when responding in Slack channels. Pure prompt content — no API key, no setup.

## Preflight

Before installing, verify Nanotars is set up:

```bash
[ -d node_modules ] && echo "DEPS: ok" || echo "DEPS: missing"
docker image inspect nanoclaw-agent:latest &>/dev/null && echo "IMAGE: ok" || echo "IMAGE: not built"
(grep -q "ANTHROPIC_API_KEY\|CLAUDE_CODE_OAUTH_TOKEN" .env 2>/dev/null || [ -f ~/.claude/.credentials.json ]) && echo "AUTH: ok" || echo "AUTH: missing"
```

If any check fails, tell the user to run `/nanotars-setup` first and stop.

## Install

1. Copy plugin files:
   ```bash
   cp -r ${CLAUDE_PLUGIN_ROOT}/files/ plugins/slack-formatting/
   ```
2. **Plugin Configuration:** By default this plugin only attaches to Slack-channel groups (`channels: ["slack"]`) and is available to all groups. To restrict further, edit `plugins/slack-formatting/plugin.json` and set:
   - `"groups"` to specific group folder names (e.g., `["slack_engineering"]`) instead of `["*"]`
   - `"channels"` to additional channel types if you want it active beyond Slack

   Most users will keep the defaults — the skill auto-applies to any Slack-bound group.
3. Rebuild and restart:
   ```bash
   npm run build
   systemctl --user restart nanotars  # or launchctl on macOS
   ```

## Verify

In a Slack channel, ask the agent to send a formatted summary (bold + bullets + a link). It should use `*bold*`, `•`, and `<url|text>` instead of `**bold**`, `-`, and `[text](url)`.

## Remove

1. ```bash
   rm -rf plugins/slack-formatting/
   ```
2. Rebuild and restart
