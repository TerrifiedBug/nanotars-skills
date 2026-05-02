---
name: add-skill-example
description: Add <capability> to NanoTars agents. Triggers on "add <capability>", "<capability> setup".
---

# Add <Capability>

Use the shared add-skill install contract from
`docs/add-skill-authoring.md`. This skill only documents plugin-specific
details.

## Plugin Adds

- Files copied to: `plugins/<name>/`
- Env vars:
  - `<ENV_VAR>` — <what it controls and whether it belongs in root `.env` or a
    group `.env`>
- Optional host files or mounts: <none>
- Container skills: `<skill-name>`

## Install

1. Run the shared preflight.
2. Copy plugin files:
   ```bash
   cp -r ${CLAUDE_PLUGIN_ROOT}/files/ plugins/<name>/
   ```
3. Apply the shared scoping prompt. If restricted, edit
   `plugins/<name>/plugin.json`.
4. Write plugin-specific env vars.
5. Rebuild and restart:
   ```bash
   npm run build
   nanotars restart
   ```

## Verify

Ask the agent: "<one concrete prompt that should exercise the skill>"

## Remove

1. Remove `plugins/<name>/`.
2. Remove `<ENV_VAR>` from the chosen env file.
3. Run `npm run build` and `nanotars restart`.
