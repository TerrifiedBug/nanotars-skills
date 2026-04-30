// Claude-mem session hooks. Ported from the upstream openclaw integration
// (https://github.com/thedotmack/claude-mem/tree/main/openclaw) and adapted
// to the Claude Agent SDK hook surface used by nanotars containers.
//
// Lifecycle:
//   getSystemPromptAddition → /api/context/inject (appended to system prompt
//                              at session-construction time; the SDK does not
//                              implement hookSpecificOutput.additionalContext
//                              in headless mode, so we use the supported
//                              systemPrompt.append injection point instead)
//   UserPromptSubmit         → /api/sessions/init   (dedup-guarded)
//   PostToolUse              → /api/sessions/observations (memory_* skipped, truncated)
//   Stop                     → /api/sessions/summarize (worker self-completes; no /complete)
//
// PreCompact is intentionally NOT hooked — re-init creates duplicate prompt
// records. The next session will pull a fresh /api/context/inject anyway.

const PROJECT = 'nanotars';
const CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000;
const PROMPT_INIT_DEDUP_MS = 30_000;
const MAX_TOOL_RESPONSE_LENGTH = 1000;

const recentPromptInits = new Map();
const contextCache = new Map();

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

function stringifyToolResponse(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function gcDedupMap(now) {
  for (const [k, t] of recentPromptInits) {
    if (now - t > 5 * PROMPT_INIT_DEDUP_MS) recentPromptInits.delete(k);
  }
}

export function register(ctx) {
  const url = ctx.env.CLAUDE_MEM_URL;
  if (!url) return {};

  log(`Session hooks enabled: ${url}`);

  return {
    // Init session in the worker so observations are accepted.
    // Dedup-guard prevents duplicate prompt records when the same prompt
    // re-fires within 30s (e.g. SDK retry, IPC pipe-in within the same turn).
    UserPromptSubmit: [{
      hooks: [async (input) => {
        const promptText = input.prompt || '';
        const sessionId = input.session_id;
        const dedupKey = `${sessionId}|${promptText.slice(0, 64)}`;
        const now = Date.now();

        const lastFired = recentPromptInits.get(dedupKey);
        if (lastFired && now - lastFired < PROMPT_INIT_DEDUP_MS) {
          log(`Skipping duplicate prompt init: session=${sessionId}`);
          return {};
        }
        recentPromptInits.set(dedupKey, now);
        gcDedupMap(now);

        log(`Session init: session=${sessionId}`);
        fireAndForget(url, '/api/sessions/init', {
          contentSessionId: sessionId,
          project: PROJECT,
          prompt: promptText,
        });
        return {};
      }],
    }],

    // Persist tool observations. Skip memory_* tools (recursive observation
    // loop), drop observations with empty cwd (worker rejects them), and
    // truncate oversized tool_response payloads.
    PostToolUse: [{
      hooks: [async (input) => {
        const toolName = input.tool_name;
        if (!toolName) return {};
        if (toolName.startsWith('memory_')) return {};

        const cwd = input.cwd || '';
        if (!cwd) {
          log(`Skipping observation (empty cwd): tool=${toolName}`);
          return {};
        }

        let toolResponseText = stringifyToolResponse(input.tool_response);
        if (toolResponseText.length > MAX_TOOL_RESPONSE_LENGTH) {
          toolResponseText = toolResponseText.slice(0, MAX_TOOL_RESPONSE_LENGTH);
        }

        log(`PostToolUse: tool=${toolName} session=${input.session_id}`);
        fireAndForget(url, '/api/sessions/observations', {
          contentSessionId: input.session_id,
          tool_name: toolName,
          tool_input: input.tool_input,
          tool_response: toolResponseText,
          cwd,
        });
        return {};
      }],
    }],

    // Summarize on stop. Worker self-completes the session when its SDK-agent
    // generator drains; no explicit /api/sessions/complete call (404 in
    // upstream worker). Awaited so in-flight observations have time to flush.
    Stop: [{
      hooks: [async (input) => {
        log(`Stop: session=${input.session_id}`);
        try {
          const res = await post(url, '/api/sessions/summarize', {
            contentSessionId: input.session_id,
            last_assistant_message: '',
          });
          log(`/api/sessions/summarize ${res.status}`);
        } catch {
          // Worker unreachable — observations still flushed via earlier POSTs.
        }
        return {};
      }],
    }],
  };
}

// Fetched once per session (with 5-min in-process cache across sessions if the
// container is reused). Result is appended to the SDK's systemPrompt by the
// agent-runner — see PluginHookModule.getSystemPromptAddition.
export async function getSystemPromptAddition(ctx) {
  const url = ctx.env.CLAUDE_MEM_URL;
  if (!url) return null;

  const now = Date.now();
  const cached = contextCache.get(PROJECT);
  if (cached && now - cached.fetchedAt < CONTEXT_CACHE_TTL_MS) {
    return cached.text;
  }

  try {
    const res = await fetch(
      `${url}/api/context/inject?projects=${encodeURIComponent(PROJECT)}`,
    );
    if (!res.ok) {
      log(`/api/context/inject ${res.status}`);
      return null;
    }
    const text = (await res.text()).trim();
    if (!text) return null;
    contextCache.set(PROJECT, { text, fetchedAt: now });
    log(`Context fetched for system prompt: ${text.length} chars`);
    return text;
  } catch {
    return null;
  }
}
