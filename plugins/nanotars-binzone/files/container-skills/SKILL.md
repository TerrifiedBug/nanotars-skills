---
name: binzone
description: Check Vale of White Horse bin collection details. Use when the user asks about bin day, rubbish collection, recycling collection, food waste, or garden waste.
allowed-tools: Bash(python3:*)
---

# Binzone

Fetch the next Vale of White Horse bin collection for the configured property UPRN.

## Default Usage

For casual asks like "what bins are next?" or "when are bins collected?", run:

```bash
python3 /workspace/.claude/skills/binzone/scripts/binzone.py
```

Summarise the result directly. Include any special message, because it often contains bank holiday or disruption information.

## Structured Output

Use JSON when adding this to scheduled digests or downstream parsing:

```bash
python3 /workspace/.claude/skills/binzone/scripts/binzone.py --json
```

JSON fields:

| Field | Meaning |
|---|---|
| `day` | Collection day text from the council page |
| `next_collection_date` | Date text after the day, when present |
| `type` | Bin collection type heading |
| `special_message` | Optional disruption or council notice |

## Configuration

Requires `BINZONE_UPRN` in the group or global environment. Prefer a group-level `.env` value when only one group should have this property lookup:

```bash
BINZONE_UPRN=123456789
```

## Rules

1. Do not call this repeatedly in the same conversation unless the user asks for a fresh check.
2. If `BINZONE_UPRN is not set`, tell the user to run `/add-skill-binzone` or add `BINZONE_UPRN` to the target group's `.env`.
3. If the council page returns unknown values, say the lookup did not expose a clear collection and suggest checking the council site.
4. For reminders, use NanoTars scheduled tasks. Do not recreate the old standalone cron container.
