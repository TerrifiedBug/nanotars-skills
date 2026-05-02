# Add-Skill Authoring Contract

This is the shared install shape for marketplace `add-skill-*` and
`add-channel-*` skills. Keep per-skill instructions focused on what the plugin
adds: files, env vars, MCP servers, mounts, hooks, and verification.

## Required Flow

1. **Preflight:** Verify the operator is in a NanoTars checkout with installed
   dependencies, a built agent image, and usable Claude auth. If preflight
   fails, stop and tell the operator to run `/nanotars-setup`.
2. **Copy files:** Copy `${CLAUDE_PLUGIN_ROOT}/files/` into the target
   `plugins/<name>/` path.
3. **Scope access:** Ask whether the plugin should be limited to specific
   groups or channels. Default to the plugin manifest's existing scope when the
   operator does not care.
4. **Write config:** Put user-specific env vars in `groups/<folder>/.env` when
   the credential is group-specific. Use root `.env` only for deployment-wide
   settings.
5. **Rebuild/restart:** Run `npm run build` and `nanotars restart`, or tell the
   operator to restart manually when service control fails.
6. **Verify:** Give one concrete command or user-facing prompt that proves the
   plugin is available.
7. **Remove:** Include the plugin path, env vars, and any host-side files that
   should be removed.

## Shared Preflight

```bash
[ -d node_modules ] && echo "DEPS: ok" || echo "DEPS: missing"
docker image inspect nanoclaw-agent:latest &>/dev/null && echo "IMAGE: ok" || echo "IMAGE: not built"
if grep -q "ANTHROPIC_API_KEY\|CLAUDE_CODE_OAUTH_TOKEN" .env 2>/dev/null || [ -f "$HOME/.claude/.credentials.json" ]; then echo "AUTH: ok"; else echo "AUTH: missing"; fi
```

## Scoping Prompt

Use this language unless the plugin has stronger defaults:

> By default this plugin follows the manifest scope. Do you want to restrict it
> to specific groups or channels? If yes, edit `plugins/<name>/plugin.json` and
> set `groups` and `channels` to explicit arrays.

For credentials that should not be shared across groups, ask for the target
group first and write env vars to `groups/<folder>/.env`.

## Keep Out Of Individual Skills

- Do not embed direct SQLite mutations. Use `nanotars` CLI/admin commands.
- Do not hard-code one deployment's group or channel names.
- Do not ask the operator to edit generated files unless the field cannot be
  safely inferred.
- Do not duplicate long troubleshooting sections when `/nanotars-debug` or a
  plugin-specific verify command is enough.
