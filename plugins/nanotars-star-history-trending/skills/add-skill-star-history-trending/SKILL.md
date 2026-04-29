---
name: add-skill-star-history-trending
description: Add weekly trending-repo scanning to NanoTars. Agents visit star-history.com, filter trending repos for relevant tools/agents, and present a curated brief. Triggers on "trending repos", "star history", "new tools".
---

# Add Star History Trending

Adds weekly trending-repo discovery via star-history.com. The agent scrapes the trending list, filters for repos relevant to your stack (agents, CLIs, automation, MCPs, smart-home), checks for duplicates against your installed skills, and presents a short brief. No API key required.

## Preflight

Before installing, verify NanoTars is set up:

```bash
[ -d node_modules ] && echo "DEPS: ok" || echo "DEPS: missing"
docker image inspect nanoclaw-agent:latest &>/dev/null && echo "IMAGE: ok" || echo "IMAGE: not built"
if grep -q "ANTHROPIC_API_KEY\|CLAUDE_CODE_OAUTH_TOKEN" .env 2>/dev/null || [ -f "$HOME/.claude/.credentials.json" ]; then echo "AUTH: ok"; else echo "AUTH: missing"; fi
```

If any check fails, tell the user to run `/nanotars-setup` first and stop.

## Prerequisites

- NanoTars must be set up and running (`/nanotars-setup`)
- No API keys or credentials required
- Recommended: an `agent-browser` plugin in the container if you want richer scraping. The skill will still work with `curl` alone, but agent-browser gives the agent a real DOM to interact with for the trending page.

## Install

1. Check current state:
   ```bash
   [ -d plugins/star-history-trending ] && echo "PLUGIN_EXISTS" || echo "NEED_PLUGIN"
   ```
   If plugin exists, skip to Verify.

2. Copy plugin files:
   ```bash
   cp -r ${CLAUDE_PLUGIN_ROOT}/files/ plugins/star-history-trending/
   ```

3. **Plugin Configuration:** By default this plugin is available to all groups and channel types. To restrict access, edit `plugins/star-history-trending/plugin.json` and set:
   - `"groups"` to specific group folder names (e.g., `["main"]`) instead of `["*"]`
   - `"channels"` to specific channel types (e.g., `["whatsapp"]`) instead of `["*"]`

   Ask the user if they want to restrict access. Most users will keep the defaults.

4. Rebuild and restart:
   ```bash
   npm run build
   nanotars restart
   ```

## Verify

Test that star-history.com is reachable:

```bash
curl -sI https://www.star-history.com/ | head -1
```

Should show `HTTP/2 200` (or `HTTP/1.1 200 OK`).

## Usage Examples

- "Any interesting trending repos this week?"
- "Show me the star-history weekly trending list"
- Include in a weekly digest: the agent reviews trending repos, skips already-reviewed ones, and surfaces only the relevant picks

## How It Works

The container skill instructs the agent to fetch the star-history.com trending page, parse the top entries, look up each repo's GitHub description via the public REST API, and filter by relevance keywords (agent, cli, memory, mcp, smart-home, etc). It tracks reviewed repos in `/workspace/group/trending-log.md` and `/workspace/group/star-history-watchlist.md` so the same repo isn't surfaced twice.

## Remove

1. `rm -rf plugins/star-history-trending/`
2. Rebuild and restart.
