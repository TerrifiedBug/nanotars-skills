/**
 * Telegram Authentication Script
 *
 * Validates the instance bot token against Telegram's getMe endpoint and
 * writes the validated token to .env. Re-runs short-circuit if the token is
 * already valid. Falls through to an interactive prompt if missing or invalid.
 *
 * Usage:
 *   node plugins/channels/telegram/auth.js                         # interactive
 *   node plugins/channels/telegram/auth.js --token <value>         # non-interactive
 *   node plugins/channels/telegram-personal/auth.js --token <value>
 */
import fs from 'fs';
import readline from 'readline';
import path from 'path';

const ENV_PATH = path.resolve('.env');
const PLUGIN_DIR = path.dirname(new URL(import.meta.url).pathname);

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--token') out.token = argv[++i];
    else if (argv[i] === '--channel') out.channel = argv[++i];
    else if (argv[i] === '--env-key') out.envKey = argv[++i];
  }
  return out;
}

function readLocalManifest() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'plugin.json'), 'utf-8'));
  } catch {
    return {};
  }
}

function normalizeChannelName(name) {
  const normalized = String(name || path.basename(PLUGIN_DIR))
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'telegram';
}

function defaultTokenEnvKey(channelName) {
  if (channelName === 'telegram') return 'TELEGRAM_BOT_TOKEN';
  return `${channelName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_BOT_TOKEN`;
}

function readEnvVar(key) {
  if (!fs.existsSync(ENV_PATH)) return null;
  const m = fs.readFileSync(ENV_PATH, 'utf-8').match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!m) return null;
  return m[1].trim().replace(/^['"]|['"]$/g, '');
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
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, ENV_PATH);
}

function writeStatus(statusDir, status) {
  fs.mkdirSync(statusDir, { recursive: true });
  fs.writeFileSync(path.join(statusDir, 'auth-status.txt'), status + '\n');
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

async function validate(token) {
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}` };
  }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: `Non-JSON response (HTTP ${res.status})` };
  }
  if (!body.ok || !body.result?.username) {
    return { ok: false, error: body.description || 'Invalid response from Telegram' };
  }
  return { ok: true, username: body.result.username };
}

async function main() {
  const args = parseArgs(process.argv);
  const manifest = readLocalManifest();
  const channelName = normalizeChannelName(args.channel || manifest.name || path.basename(PLUGIN_DIR));
  const envKey = args.envKey || manifest.telegramBotTokenEnv || defaultTokenEnvKey(channelName);
  const statusDir = path.join('data', 'channels', channelName);
  const envToken = readEnvVar(envKey);

  // Short-circuit: existing valid env token AND no flag override → already authenticated.
  if (!args.token && envToken) {
    const result = await validate(envToken);
    if (result.ok) {
      writeStatus(statusDir, 'already_authenticated');
      console.log(`✓ Already authenticated as @${result.username}`);
      return 0;
    }
    console.log(`Existing ${envKey} failed validation: ${result.error}`);
    console.log('Falling through to prompt for a new token.\n');
  }

  // Determine the token to validate: explicit flag wins, else interactive prompt.
  let token;
  if (args.token) {
    token = args.token;
  } else {
    console.log('Get a bot token from @BotFather on Telegram (`/newbot` or `/mybots → API Token`).');
    console.log('');
    token = await prompt('Telegram bot token: ');
    if (!token) {
      writeStatus(statusDir, 'failed');
      console.error('No token provided. Aborting.');
      return 1;
    }
  }

  const result = await validate(token);
  if (!result.ok) {
    writeStatus(statusDir, 'failed');
    console.error(`✗ Validation failed: ${result.error}`);
    console.error('Hint: tokens look like `1234567890:ABC...` — double-check you copied the whole line from BotFather.');
    return 1;
  }

  try {
    upsertEnvVar(envKey, token);
  } catch (err) {
    writeStatus(statusDir, 'failed');
    console.error(`✗ Could not write to .env: ${err.message}`);
    return 1;
  }
  writeStatus(statusDir, 'ok');
  console.log(`✓ Validated as @${result.username}`);
  console.log(`✓ ${envKey} written to .env`);
  return 0;
}

main().then(code => process.exit(code), err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
