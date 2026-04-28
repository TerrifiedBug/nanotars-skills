---
name: star-history-trending
description: Scan star-history.com weekly trending list for repos relevant to our stack. Use when asked about trending repos, new tools, or skill discovery.
allowed-tools: Bash(curl:*),Bash(agent-browser:*)
---

# Star History Trending Review

Daily/on-demand scan of https://www.star-history.com/ trending repos to find useful tools, agents, or patterns.

## Steps

1. Open https://www.star-history.com/ using agent-browser and scrape the weekly trending list (top 20).
   - Run `agent-browser open https://www.star-history.com/` then `agent-browser snapshot -i`
   - Parse each entry for: rank, repo name, star growth, repo path.

2. For each repo, fetch description:
   ```bash
   curl -s "https://api.github.com/repos/OWNER/REPO" | jq -r '.description'
   ```

3. Filter by relevance keywords:
   - HIGH: agent, cli, memory, context, automation, terminal, skill, plugin, hook, lifeos, notion, calendar, mcp, home-assistant, iot
   - MEDIUM: assistant, workflow, productivity, dashboard, sync, backup, export, voice, llm, rag
   - IGNORE: pure web frameworks, unrelated languages, games, UI libraries without CLI angle

4. Check /workspace/.claude/skills/ for duplicate capabilities.

5. Check /workspace/group/trending-log.md and /workspace/group/star-history-watchlist.md — skip already-reviewed repos.

6. If no relevant repos: append "No relevant trending repos today — [DATE]" to trending-log.md. Stay silent.

7. If relevant repos found, present:

   *Star History Trending — [DATE]*

   _Top Picks_

   [rank] *repo-name* (+Xk) — one-line description
   Relevance: High/Medium — why it matters
   Action: Review / Watch / Skip
   URL: github url

8. Update tracking files:
   - Append to /workspace/group/trending-log.md
   - Add watch candidates to /workspace/group/star-history-watchlist.md

## Tips
- Don't be noisy — skip days with nothing relevant
- Prioritize repos solving real problems (memory, agent orchestration, HA, CLI)
- Promising but unclear repos go to watch list for weekly re-check
- Never use markdown formatting — use *bold* and _italic_ only
