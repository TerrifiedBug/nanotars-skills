/**
 * Slack Authentication Script
 *
 * Validates SLACK_BOT_TOKEN (xoxb-) via auth.test and SLACK_APP_TOKEN (xapp-)
 * via apps.connections.open (Socket Mode handshake). Both tokens are required
 * because the Slack channel plugin uses Socket Mode. Re-runs short-circuit if
 * both tokens are already valid; falls through to interactive prompts for any
 * missing/invalid token.
 *
 * Usage:
 *   node plugins/channels/slack/auth.js                                    # interactive
 *   node plugins/channels/slack/auth.js --token <xoxb-> --app-token <xapp-> # non-interactive
 */
import fs from 'fs';
import readline from 'readline';
import path from 'path';

const ENV_PATH = path.resolve('.env');
const STATUS_DIR = './data/channels/slack';
const STATUS_FILE = `${STATUS_DIR}/auth-status.txt`;
const BOT_KEY = 'SLACK_BOT_TOKEN';
const APP_KEY = 'SLACK_APP_TOKEN';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--token') out.token = argv[++i];
    if (argv[i] === '--app-token') out.appToken = argv[++i];
  }
  return out;
}

function readEnvVar(key) {
  if (!fs.existsSync(ENV_PATH)) return null;
  const m = fs.readFileSync(ENV_PATH, 'utf-8').match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? parseEnvValue(m[1]) : null;
}

function parseEnvValue(raw) {
  let value = raw.trim();
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    let out = '';
    for (let i = 1; i < value.length; i++) {
      const ch = value[i];
      if (ch === quote) return out;
      if (quote === '"' && ch === '\\' && i + 1 < value.length) {
        out += value[++i];
      } else {
        out += ch;
      }
    }
    return out;
  }
  return value.replace(/\s+#.*$/, '').trim();
}

function upsertEnvVar(key, value) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
  const lineRegex = new RegExp(`^${key}=.*$`, 'm');
  if (lineRegex.test(content)) {
    content = content.replace(lineRegex, `${key}=${value}`);
  } else {
    if (content.length > 0 && !content.endsWith('\n')) content += '\n';
    content += `${key}=${value}\n`;
  }
  const tmp = `${ENV_PATH}.tmp`;
  try {
    fs.unlinkSync(tmp);
  } catch {}
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, ENV_PATH);
}

function upsertMultipleEnvVars(updates) {
  // updates: { KEY: value, ... }
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
  for (const [key, value] of Object.entries(updates)) {
    const lineRegex = new RegExp(`^${key}=.*$`, 'm');
    if (lineRegex.test(content)) {
      content = content.replace(lineRegex, `${key}=${value}`);
    } else {
      if (content.length > 0 && !content.endsWith('\n')) content += '\n';
      content += `${key}=${value}\n`;
    }
  }
  const tmp = `${ENV_PATH}.tmp`;
  try {
    fs.unlinkSync(tmp);
  } catch {}
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, ENV_PATH);
}

function writeStatus(status) {
  fs.mkdirSync(STATUS_DIR, { recursive: true });
  fs.writeFileSync(STATUS_FILE, status + '\n');
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

async function validateBot(token) {
  let res;
  try {
    res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}` };
  }
  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: `Non-JSON response (HTTP ${res.status})` };
  }
  if (!body.ok) return { ok: false, error: body.error || `HTTP ${res.status}` };
  return { ok: true, user: body.user, team: body.team };
}

async function validateApp(token) {
  let res;
  try {
    res = await fetch('https://slack.com/api/apps.connections.open', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}` };
  }
  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: `Non-JSON response (HTTP ${res.status})` };
  }
  if (!body.ok) return { ok: false, error: body.error || `HTTP ${res.status}` };
  // body.url is a wss:// endpoint we don't actually open — the channel plugin handles that.
  return { ok: true };
}

async function main() {
  const args = parseArgs(process.argv);
  const envBot = readEnvVar(BOT_KEY);
  const envApp = readEnvVar(APP_KEY);

  // Short-circuit: BOTH tokens present in env AND no flag override AND BOTH validate.
  if (!args.token && !args.appToken && envBot && envApp) {
    const botResult = await validateBot(envBot);
    const appResult = await validateApp(envApp);
    if (botResult.ok && appResult.ok) {
      writeStatus('already_authenticated');
      console.log(`✓ Already authenticated as @${botResult.user} (workspace: ${botResult.team})`);
      return 0;
    }
    if (!botResult.ok) console.log(`Existing SLACK_BOT_TOKEN failed validation: ${botResult.error}`);
    if (!appResult.ok) console.log(`Existing SLACK_APP_TOKEN failed validation: ${appResult.error}`);
    console.log('Falling through to prompt for replacement tokens.\n');
  }

  // Determine tokens to validate. Each can come from a flag, an env value (if present and we're
  // here because the OTHER token was missing/invalid), or an interactive prompt.
  const needsPreamble = !args.token || !args.appToken;
  if (needsPreamble) {
    console.log('Visit https://api.slack.com/apps → Create New App → enable Socket Mode →');
    console.log('  install to workspace. The bot token (xoxb-) is under OAuth & Permissions;');
    console.log('  the app token (xapp-) is under Basic Information → App-Level Tokens.');
    console.log('');
  }

  let botToken;
  if (args.token) {
    botToken = args.token;
  } else if (envBot) {
    botToken = envBot;
    if (args.appToken) console.log('Using existing SLACK_BOT_TOKEN from .env.');
  } else {
    botToken = await prompt('Slack bot token (xoxb-): ');
  }

  let appToken;
  if (args.appToken) {
    appToken = args.appToken;
  } else if (envApp) {
    appToken = envApp;
    if (args.token) console.log('Using existing SLACK_APP_TOKEN from .env.');
  } else {
    appToken = await prompt('Slack app token (xapp-): ');
  }

  if (!botToken || !appToken) {
    writeStatus('failed');
    console.error('Both bot token and app token are required. Aborting.');
    return 1;
  }

  const botResult = await validateBot(botToken);
  if (!botResult.ok) {
    writeStatus('failed');
    console.error(`✗ Bot token validation failed: ${botResult.error}`);
    console.error('Hint: bot tokens start with `xoxb-`. Re-check OAuth & Permissions → Bot User OAuth Token.');
    return 1;
  }

  const appResult = await validateApp(appToken);
  if (!appResult.ok) {
    writeStatus('failed');
    console.error(`✗ App token validation failed: ${appResult.error}`);
    console.error('Hint: app tokens start with `xapp-` and need the `connections:write` scope. Re-check Basic Information → App-Level Tokens.');
    return 1;
  }

  try {
    upsertMultipleEnvVars({ [BOT_KEY]: botToken, [APP_KEY]: appToken });
  } catch (err) {
    writeStatus('failed');
    console.error(`✗ Could not write to .env: ${err.message}`);
    return 1;
  }
  writeStatus('ok');
  console.log(`✓ Validated as @${botResult.user} (workspace: ${botResult.team})`);
  console.log(`✓ SLACK_BOT_TOKEN and SLACK_APP_TOKEN written to .env`);
  return 0;
}

main().then(code => process.exit(code), err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
