// Claude-mem session hooks: mirrors the official OpenClaw integration pattern.
// Registers for multiple SDK events to manage the full session lifecycle:
//   UserPromptSubmit → /api/sessions/init (create/continue session with prompt)
//   PostToolUse      → /api/sessions/observations (queue tool use for AI processing)
//   Stop             → /api/sessions/summarize + /api/sessions/complete
//   PreCompact       → /api/sessions/init (re-init after context compaction)

function log(msg) {
  console.error(`[agent-runner] [claude-mem] ${msg}`);
}

function post(url, path, body) {
  return fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function fireAndForget(url, path, body) {
  post(url, path, body).then(
    (res) => log(`${path} ${res.status}`),
    () => {},
  );
}

export function register(ctx) {
  const url = ctx.env.CLAUDE_MEM_URL;
  if (!url) return {};

  const PROJECT = `nanoclaw-${ctx.groupFolder || 'main'}`;

  log(`Session hooks enabled: ${url}`);

  return {
    // ── Session init: capture user prompt and create/continue session ──
    UserPromptSubmit: [{
      hooks: [async (input) => {
        log(`Session init: session=${input.session_id}`);
        fireAndForget(url, '/api/sessions/init', {
          contentSessionId: input.session_id,
          project: PROJECT,
          prompt: input.prompt || '',
        });
        return {};
      }],
    }],

    // ── Tool observations: queue for AI processing ──
    PostToolUse: [{
      hooks: [async (input) => {
        log(`PostToolUse: tool=${input.tool_name} session=${input.session_id}`);
        fireAndForget(url, '/api/sessions/observations', {
          contentSessionId: input.session_id,
          tool_name: input.tool_name,
          tool_input: input.tool_input,
          tool_response: input.tool_response,
          cwd: input.cwd || '',
        });
        return {};
      }],
    }],

    // ── Stop: summarize then complete ──
    Stop: [{
      hooks: [async (input) => {
        log(`Stop: session=${input.session_id}`);
        // Await summarize so in-flight observations have time to arrive
        try {
          const res = await post(url, '/api/sessions/summarize', {
            contentSessionId: input.session_id,
            last_assistant_message: '',
          });
          log(`/api/sessions/summarize ${res.status}`);
        } catch { /* worker unreachable */ }
        fireAndForget(url, '/api/sessions/complete', {
          contentSessionId: input.session_id,
        });
        return {};
      }],
    }],

    // ── PreCompact: re-init session after context compaction ──
    PreCompact: [{
      hooks: [async (input) => {
        log(`PreCompact re-init: session=${input.session_id}`);
        fireAndForget(url, '/api/sessions/init', {
          contentSessionId: input.session_id,
          project: PROJECT,
          prompt: '',
        });
        return {};
      }],
    }],
  };
}
