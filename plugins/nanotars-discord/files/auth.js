/**
 * Discord Authentication Script
 *
 * Validates DISCORD_BOT_TOKEN against Discord's /users/@me endpoint and writes
 * the validated token to .env. Re-runs short-circuit if the token is already
 * valid. Falls through to an interactive prompt if missing or invalid.
 *
 * Usage:
 *   node plugins/channels/discord/auth.js                  # interactive
 *   node plugins/channels/discord/auth.js --token <value>  # non-interactive
 */
import fs from 'fs';
import readline from 'readline';
import path from 'path';

const ENV_PATH = path.resolve('.env');
const STATUS_DIR = './data/channels/discord';
const STATUS_FILE = `${STATUS_DIR}/auth-status.txt`;
const ENV_KEY = 'DISCORD_BOT_TOKEN';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--token') out.token = argv[++i];
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

function writeStatus(status) {
  fs.mkdirSync(STATUS_DIR, { recursive: true });
  fs.writeFileSync(STATUS_FILE, status + '\n');
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

async function validate(token) {
  let res;
  try {
    res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` },
    });
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
  if (!body.id || !body.username) {
    return { ok: false, error: 'Invalid response from Discord' };
  }
  return { ok: true, username: body.username, id: body.id };
}

async function main() {
  const args = parseArgs(process.argv);
  const envToken = readEnvVar(ENV_KEY);

  // Short-circuit: existing valid env token AND no flag override → already authenticated.
  if (!args.token && envToken) {
    const result = await validate(envToken);
    if (result.ok) {
      writeStatus('already_authenticated');
      console.log(`✓ Already authenticated as @${result.username} (id: ${result.id})`);
      return 0;
    }
    console.log(`Existing DISCORD_BOT_TOKEN failed validation: ${result.error}`);
    console.log('Falling through to prompt for a new token.\n');
  }

  // Determine the token to validate: explicit flag wins, else interactive prompt.
  let token;
  if (args.token) {
    token = args.token;
  } else {
    console.log('Get a bot token from https://discord.com/developers/applications →');
    console.log('  New Application → Bot tab → Reset Token. Enable Privileged Gateway');
    console.log('  Intents (Message Content) if you need DM/text content.');
    console.log('');
    token = await prompt('Discord bot token: ');
    if (!token) {
      writeStatus('failed');
      console.error('No token provided. Aborting.');
      return 1;
    }
  }

  const result = await validate(token);
  if (!result.ok) {
    writeStatus('failed');
    console.error(`✗ Validation failed: ${result.error}`);
    console.error('Hint: bot tokens look like a long opaque string. If you see "HTTP 401", the token is wrong or revoked — reset it from the Bot tab.');
    return 1;
  }

  try {
    upsertEnvVar(ENV_KEY, token);
  } catch (err) {
    writeStatus('failed');
    console.error(`✗ Could not write to .env: ${err.message}`);
    return 1;
  }
  writeStatus('ok');
  console.log(`✓ Validated as @${result.username} (id: ${result.id})`);
  console.log(`✓ DISCORD_BOT_TOKEN written to .env`);
  return 0;
}

main().then(code => process.exit(code), err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
