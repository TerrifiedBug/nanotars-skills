---
name: add-skill-binzone
description: Add Vale of White Horse bin collection lookup to NanoTars. Requires a property UPRN. Triggers on "add binzone", "bin collection setup", "bins skill".
---

# Add Binzone

Configures Vale of White Horse bin collection lookup for one NanoTars group. This replaces the old standalone bin-collection-reminder cron container: NanoTars runs the lookup helper and sends replies through the group's existing channel.

## Preflight

Before installing, verify NanoTars is set up:

```bash
[ -d node_modules ] && echo "DEPS: ok" || echo "DEPS: missing"
docker image inspect nanoclaw-agent:latest &>/dev/null && echo "IMAGE: ok" || echo "IMAGE: missing"
if grep -q "ANTHROPIC_API_KEY\|CLAUDE_CODE_OAUTH_TOKEN" .env 2>/dev/null || [ -f "$HOME/.claude/.credentials.json" ]; then echo "AUTH: ok"; else echo "AUTH: missing"; fi
```

If any check fails, tell the user to run `/nanotars-setup` first and stop.

## Prerequisites

- A Vale of White Horse Council property UPRN.
- A target NanoTars group folder, for example `main` or `whatsapp-danny`.

## Install

1. Ask which group should get bin collection lookup:
   ```bash
   ls -d groups/*/
   ```

2. Copy plugin files:
   ```bash
   cp -r ${CLAUDE_PLUGIN_ROOT}/files/ plugins/binzone/
   ```

3. Restrict the plugin to the chosen group by editing `plugins/binzone/plugin.json`:
   ```json
   "groups": ["GROUP_FOLDER"]
   ```

   Keep `"channels": ["*"]` unless the user explicitly wants this available only on one channel type.

4. Add the UPRN to the target group's `.env`:
   ```bash
   mkdir -p groups/GROUP_FOLDER
   printf '\nBINZONE_UPRN=YOUR_UPRN_HERE\n' >> groups/GROUP_FOLDER/.env
   ```

5. Rebuild and restart, because this plugin adds Python HTML parsing dependencies:
   ```bash
   ./container/build.sh
   nanotars restart
   ```

## Verify

Ask the group: "what bins are next?"

To test directly inside a running agent container:

```bash
docker exec -i $(docker ps --filter name=nanoclaw- --format '{{.Names}}' | head -1) \
  python3 /workspace/.claude/skills/binzone/scripts/binzone.py
```

## Scheduled Reminders

Use a NanoTars scheduled task for reminders. Suggested prompt:

```text
Check the binzone skill and send the next bin collection summary, including any important council message.
```

Set the schedule to the reminder cadence the user wants, such as Sunday evening or the morning before collection. Do not recreate the old standalone cron container.

## Troubleshooting

- **`BINZONE_UPRN is not set`**: add it to the selected group's `.env` and restart.
- **Unknown day/type**: the council page did not expose the expected fields. Ask the user to verify the UPRN on the council site.
- **Import error for `bs4`, `lxml`, or `requests`**: rebuild the agent image with `./container/build.sh`, then restart.
- **Wrong group can see the skill**: restrict `plugins/binzone/plugin.json` to the intended `groups` list.

## Uninstall

1. Remove `plugins/binzone/`
2. Remove `BINZONE_UPRN` from the group `.env`
3. Rebuild and restart:
   ```bash
   ./container/build.sh
   nanotars restart
   ```
