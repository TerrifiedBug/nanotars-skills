---
name: add-skill-karpathy-llm-wiki
description: Add a persistent Karpathy-style LLM Wiki to a NanoTars group. The agent maintains a structured, interlinked markdown knowledge base across ingest / query / lint operations. Triggers on "add wiki", "add karpathy wiki", "llm wiki", "knowledge base", "wiki skill".
---

# Add Karpathy LLM Wiki

Sets up a persistent wiki knowledge base on a NanoTars group, based on Karpathy's LLM Wiki pattern. The agent becomes a disciplined wiki maintainer — every source you drop in gets read, integrated into entity/concept pages, cross-linked, and logged. Not RAG retrieval; a living, compounding knowledge base.

## Preflight

Before installing, verify NanoTars is set up:

```bash
[ -d node_modules ] && echo "DEPS: ok" || echo "DEPS: missing"
docker image inspect nanoclaw-agent:latest &>/dev/null && echo "IMAGE: ok" || echo "IMAGE: not built"
if grep -q "ANTHROPIC_API_KEY\|CLAUDE_CODE_OAUTH_TOKEN" .env 2>/dev/null || [ -f "$HOME/.claude/.credentials.json" ]; then echo "AUTH: ok"; else echo "AUTH: missing"; fi
```

If any check fails, tell the user to run `/nanotars-setup` first and stop.

## Step 1: Read the pattern

Read `${CLAUDE_PLUGIN_ROOT}/skills/add-skill-karpathy-llm-wiki/llm-wiki.md` — Karpathy's full LLM Wiki idea. Understand it before proceeding. Summarise the core idea to the user briefly, then discuss what they want to build.

## Step 2: Choose a group

AskUserQuestion: "Which group should host the wiki?"

1. **Main group** — add to your existing main chat
2. **Dedicated group** — create a new group just for the wiki (you'll need to register it via `/register-group <folder>` from your main chat after this)
3. **Other** — pick an existing group from `/list-groups`

The wiki ends up at `groups/<folder>/wiki/` with raw inputs at `groups/<folder>/sources/`.

## Step 3: Install plugin files

Copy plugin assets into place:

```bash
mkdir -p plugins/karpathy
cp -r ${CLAUDE_PLUGIN_ROOT}/files/* plugins/karpathy/
```

This installs the container-side wiki SKILL at `plugins/karpathy/container-skills/wiki/SKILL.md`. The plugin loader will mount it into the agent container as `/workspace/.claude/skills/wiki/`.

## Step 4: Design collaboratively

Discuss with the user based on the pattern:
- What's the wiki's domain or topic? (Single-domain or multi-domain registry?)
- What kinds of sources will they add? (URLs, PDFs, images, voice notes, books, transcripts)
- Do they want the full three-layer architecture or a lighter version?
- Any specific conventions they care about? (The pattern intentionally leaves this open.)

## Step 5: Scaffold the wiki

Based on the discussion, create the wiki structure inside the chosen group folder:

```bash
mkdir -p groups/<folder>/wiki/{entities,concepts,reading-notes}
mkdir -p groups/<folder>/sources
```

Initial files:

```bash
cat > groups/<folder>/wiki/index.md <<'EOF'
# Wiki Index

Catalog of every wiki page. Read first on every query. Update on every ingest.

## Entities

(none yet)

## Concepts

(none yet)

## Reading notes

(none yet)
EOF

cat > groups/<folder>/wiki/log.md <<'EOF'
# Wiki Log

Append-only chronological record of ingests, queries, lints.

## [<TODAY>] init | wiki created
EOF
```

For multi-domain wikis, also create `wiki/_registry.md` cataloguing each domain subdirectory and add a per-domain `SCHEMA.md` template.

## Step 6: Wire the group's CLAUDE.md

Edit `groups/<folder>/CLAUDE.md` (or its `.local.md` companion) to point at the wiki and the container skill. Add a section like:

```markdown
## Wiki

You maintain a persistent personal knowledge wiki for the user.

- `wiki/` — your maintained markdown pages (entities, concepts, reading-notes, syntheses)
- `sources/` — raw curated inputs the user gives you (read-only)
- `wiki/index.md` — catalog; read FIRST on every query
- `wiki/log.md` — append-only chronological record
- `/workspace/.claude/skills/wiki/SKILL.md` — full schema and ingest discipline. Read it when in doubt.

**Three operations:** `ingest` (a new source arrives), `query` (a question to answer from accumulated knowledge), `lint` (periodic health check).

**Ingest discipline (critical):** when the user provides multiple sources or a folder, process them strictly **one at a time**. For each: read in full → discuss takeaways → update wiki pages → update index + log → THEN move to the next. Never batch-read and synthesise — that produces shallow generic pages.
```

## Step 7: Optional weekly lint schedule

AskUserQuestion: "Schedule a periodic wiki health check?"

1. **Weekly (Sun 10:00 local)** — recommended
2. **Monthly (1st of month, 10:00)**
3. **Skip — lint manually**

If yes, schedule a NanoTars task. Use the `/register-group` flow to confirm the group is wired, then ask the user to run `/list-groups` so we have the chat_jid + folder. Insert via:

```bash
node -e "
const Database = require('better-sqlite3');
const { CronExpressionParser } = require('cron-parser');
const db = new Database('store/messages.db');
const cronExpr = '0 10 * * 0';   // weekly Sun 10:00
const interval = CronExpressionParser.parse(cronExpr, { tz: process.env.TZ || 'UTC' });
const nextRun = interval.next().toISOString();
db.prepare('INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
  'wiki-lint',
  '<group_folder>',
  '<chat_jid>',
  'Run a wiki health check per /workspace/.claude/skills/wiki/SKILL.md (the LINT operation). Walk wiki/ and report contradictions, stale claims, orphan pages, missing entity/concept pages, missing cross-references, and data gaps. Report findings as a compact list. Do NOT auto-fix — the user decides. Append a YYYY-MM-DD lint entry to wiki/log.md.',
  'cron',
  cronExpr,
  'group',
  nextRun,
  'active',
  new Date().toISOString()
);
db.close();
console.log('wiki-lint task created');
"
```

For monthly: `0 10 1 * *` instead.

## Step 8: Source-handling capabilities

Based on the source types the user plans to ingest (Step 4), confirm needed capabilities are installed:

- **URLs** → built-in `WebFetch` returns summaries; for full-text ingestion the agent should `curl` directly into `sources/` (the container skill specifies this).
- **PDFs** → may need a PDF reader skill if not already present.
- **Voice notes** → install transcription via `/add-skill-transcription` if not present.
- **Images / vision** → handled natively by Claude.

If a needed capability is missing, point the user at the relevant `/add-skill-*` flow.

## Step 9: Restart and test

```bash
nanotars restart
```

Test: send a URL or short article to the wiki group. The agent should fetch it into `sources/`, discuss takeaways, then write reading notes + entity/concept pages and update index + log.

## Verify

- `ls groups/<folder>/wiki/` — should show `index.md`, `log.md`, plus subdirs
- After first ingest: `cat groups/<folder>/wiki/log.md` — should show the timestamped ingest entry
- `tail -10 logs/nanotars.log | grep -i wiki` — agent should reference the wiki skill

## Uninstall

1. `nanotars stop`
2. `rm -rf plugins/karpathy/`
3. The wiki content under `groups/<folder>/wiki/` is preserved — delete manually if wanted: `rm -rf groups/<folder>/wiki groups/<folder>/sources`
4. Remove any `wiki-lint` scheduled task via `/delete-group <folder>` and re-register without it, OR file a backlog request for a `/delete-task` admin command (not yet shipped).
5. `nanotars restart`
