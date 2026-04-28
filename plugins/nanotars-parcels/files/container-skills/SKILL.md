---
name: parcels
description: Track parcel deliveries via parcelapp.net's API. Use when the user asks "where's my parcel", "any parcels coming", "check my deliveries", "track <tracking number>", or anything about shipment status.
allowed-tools: Bash(python3:*)
---

# Parcels — delivery tracking

Query Parcel's API for active and recent deliveries. Requires `$PARCEL_API_KEY` (set on the host via `/add-skill-parcels`; if missing, tell the user to run that flow).

## Default usage

For casual asks like "any parcels coming?" or "where's my stuff?" → run the **active** filter, include carrier names, and summarise the latest tracking event for each shipment.

```bash
python3 /workspace/.claude/skills/parcels/scripts/parcel_api.py active --include-carriers
```

## Options

```bash
# Active deliveries (default — currently in transit, awaiting pickup, etc.)
python3 /workspace/.claude/skills/parcels/scripts/parcel_api.py active

# Recent (broader history including completed)
python3 /workspace/.claude/skills/parcels/scripts/parcel_api.py recent

# Raw JSON (for downstream parsing / digests)
python3 /workspace/.claude/skills/parcels/scripts/parcel_api.py active --json

# More tracking events per delivery in the text output
python3 /workspace/.claude/skills/parcels/scripts/parcel_api.py active --events 5

# Resolve cryptic carrier codes (e.g. "rmg") to friendly names ("Royal Mail")
python3 /workspace/.claude/skills/parcels/scripts/parcel_api.py active --include-carriers
```

## Output

Default output is a concise human summary suitable for chat replies. Each delivery shows: description, status, carrier, tracking number, expected window, latest tracking event. Use `--json` when you need structured data (e.g. for the morning digest).

## Status codes (returned by the API)

| Code | Meaning |
|---|---|
| 0 | completed |
| 1 | frozen |
| 2 | in transit |
| 3 | awaiting pickup |
| 4 | out for delivery |
| 5 | not found |
| 6 | delivery attempt failed |
| 7 | exception / attention required |
| 8 | label created (carrier not yet in possession) |

## Rules

1. **Rate limit: 20 requests/hour.** Don't poll aggressively. Trigger on user request or once-per-digest, not on every chat turn.
2. The API returns server-cached data — it does NOT force a carrier refresh.
3. Use `active` for "what's coming"; use `recent` for "did X arrive yet" / broader history.
4. Surface the latest tracking event first when summarising — that's the most useful signal.
5. If the user asks about a specific tracking number that isn't in the active list, try `recent`. If still not found, the parcel may not be registered in their Parcel app — say so rather than fabricating.

## Failure modes

- `PARCEL_API_KEY is not set` → tell the user to run `/add-skill-parcels` on the host.
- HTTP 401/403 → key is wrong, expired, or revoked. Tell the user to re-generate from the Parcel app's API Access settings.
- HTTP 429 → rate-limited. Back off and retry later, or tell the user to ask again in a few minutes.
- Empty `deliveries` array → nothing matches that filter. Try the other one (active ↔ recent), or note that nothing is currently tracked.
