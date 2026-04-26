/**
 * WhatsApp Authentication Script
 *
 * Run this during setup to authenticate with WhatsApp.
 * Displays QR code, waits for scan, saves credentials, then exits.
 *
 * Usage: node plugins/channels/whatsapp/auth.js
 *        node plugins/channels/whatsapp/auth.js --pairing-code --phone 14155551234
 *        node plugins/channels/whatsapp/auth.js --serve   (headless: serves QR via HTTP)
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import readline from 'readline';

import makeWASocket, {
  Browsers,
  DisconnectReason,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { useSqliteAuthState } from './sqlite-auth-state.js';

const AUTH_DIR = './data/channels/whatsapp/auth';
const QR_FILE = './data/channels/whatsapp/qr-data.txt';
const STATUS_FILE = './data/channels/whatsapp/auth-status.txt';

const logger = pino({ level: 'warn' });

const usePairingCode = process.argv.includes('--pairing-code');
const serveQR = process.argv.includes('--serve');
const phoneArg = process.argv.find((_, i, arr) => arr[i - 1] === '--phone');

function askQuestion(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

let qrServer;
// Pending long-poll responses, drained whenever the QR or auth state changes.
// Mirrors qwibitai/nanoclaw v2 setup/whatsapp-auth.ts long-poll pattern so the
// browser updates without a page reload when the QR rotates.
const pendingPolls = [];

function readQR() {
  try {
    return fs.existsSync(QR_FILE) ? fs.readFileSync(QR_FILE, 'utf8') : '';
  } catch {
    return '';
  }
}

function readStatus() {
  try {
    return fs.existsSync(STATUS_FILE) ? fs.readFileSync(STATUS_FILE, 'utf8') : '';
  } catch {
    return '';
  }
}

function notifyQRWatchers() {
  const qr = readQR();
  const status = readStatus();
  const authed = status === 'authenticated' || status === 'already_authenticated';
  const payload = JSON.stringify({ qr, authenticated: authed });
  while (pendingPolls.length > 0) {
    const res = pendingPolls.shift();
    try {
      if (!res.writableEnded) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(payload);
      }
    } catch {
      /* client gone */
    }
  }
}

function renderQRPage(initialQR) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>WhatsApp QR</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/qrcode@1/build/qrcode.min.js"></script>
<style>body{display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#111;flex-direction:column;color:#fff;font-family:sans-serif}
canvas{max-width:90vw;max-height:70vh}h2{margin-bottom:1em}.hint{margin-top:1em;opacity:0.6}</style></head>
<body><h2>Scan with WhatsApp</h2><canvas id="qr"></canvas>
<p class="hint">Settings → Linked Devices → Link a Device</p>
<script>
let currentQR = ${JSON.stringify(initialQR)};
function render(qr) {
  if (!qr) return;
  QRCode.toCanvas(document.getElementById('qr'), qr, { width: 400, margin: 2 });
}
render(currentQR);
async function poll() {
  try {
    const r = await fetch('/qr-status?since=' + encodeURIComponent(currentQR), { cache: 'no-store' });
    if (!r.ok) { setTimeout(poll, 2000); return; }
    const data = await r.json();
    if (data.authenticated) { window.location.href = '/authenticated'; return; }
    if (data.qr && data.qr !== currentQR) { currentQR = data.qr; render(currentQR); }
    poll();
  } catch (e) {
    setTimeout(poll, 2000);
  }
}
poll();
</script>
</body></html>`;
}

function renderAuthenticatedPage() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>WhatsApp Connected</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#111;flex-direction:column;color:#fff;font-family:sans-serif}
.check{font-size:64px;color:#27ae60;margin-bottom:16px}h2{margin:0 0 8px}p{opacity:0.6}</style></head>
<body><div class="check">&#10003;</div><h2>Connected to WhatsApp</h2><p>You can close this tab.</p>
</body></html>`;
}

function startQRServer(qrData) {
  if (qrServer) return;

  const port = parseInt(process.env.QR_PORT || '8899', 10);
  qrServer = http.createServer((req, res) => {
    const url = req.url || '/';

    if (url.startsWith('/qr-status')) {
      // Long-poll: hold the request until QR rotates, status changes, or
      // 25s timeout elapses. The client passes ?since=<currentQR> so we can
      // return immediately if it's already stale.
      const sinceMatch = url.match(/[?&]since=([^&]*)/);
      const since = sinceMatch ? decodeURIComponent(sinceMatch[1]) : '';
      const currentQR = readQR();
      const status = readStatus();
      const authed = status === 'authenticated' || status === 'already_authenticated';
      if (authed || (currentQR && currentQR !== since)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ qr: currentQR, authenticated: authed }));
        return;
      }
      pendingPolls.push(res);
      const timer = setTimeout(() => {
        const idx = pendingPolls.indexOf(res);
        if (idx >= 0) pendingPolls.splice(idx, 1);
        if (!res.writableEnded) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ qr: currentQR, authenticated: false }));
        }
      }, 25000);
      req.on('close', () => {
        clearTimeout(timer);
        const idx = pendingPolls.indexOf(res);
        if (idx >= 0) pendingPolls.splice(idx, 1);
      });
      return;
    }

    if (url.startsWith('/authenticated')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(renderAuthenticatedPage());
      return;
    }

    // Default route: serve the QR page with the latest QR baked in. The
    // embedded JS long-polls /qr-status to swap in fresh QRs without reload.
    const currentQR = readQR() || qrData;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(renderQRPage(currentQR));
  });

  qrServer.listen(port, '0.0.0.0', () => {
    console.log(`\n🌐 QR code available at http://0.0.0.0:${port}`);
    console.log('  Open this URL in a browser to scan the QR code.\n');
  });
}

async function connectSocket(phoneNumber) {
  const { state, saveCreds } = await useSqliteAuthState(AUTH_DIR);

  if (state.creds.registered) {
    fs.writeFileSync(STATUS_FILE, 'already_authenticated');
    console.log('✓ Already authenticated with WhatsApp');
    console.log('  To re-authenticate, delete data/channels/whatsapp/auth/ and run again.');
    process.exit(0);
  }

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    logger,
    browser: Browsers.macOS('Chrome'),
  });

  if (usePairingCode && phoneNumber && !state.creds.me) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber);
        console.log(`\n🔗 Your pairing code: ${code}\n`);
        console.log('  1. Open WhatsApp on your phone');
        console.log('  2. Tap Settings → Linked Devices → Link a Device');
        console.log('  3. Tap "Link with phone number instead"');
        console.log(`  4. Enter this code: ${code}\n`);
        fs.writeFileSync(STATUS_FILE, `pairing_code:${code}`);
      } catch (err) {
        console.error('Failed to request pairing code:', err.message);
        process.exit(1);
      }
    }, 3000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      fs.writeFileSync(QR_FILE, qr);
      notifyQRWatchers();

      if (serveQR) {
        startQRServer(qr);
      } else {
        console.log('Scan this QR code with WhatsApp:\n');
        console.log('  1. Open WhatsApp on your phone');
        console.log('  2. Tap Settings → Linked Devices → Link a Device');
        console.log('  3. Point your camera at the QR code below\n');
        qrcode.generate(qr, { small: true });
      }
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;

      if (reason === DisconnectReason.loggedOut) {
        fs.writeFileSync(STATUS_FILE, 'failed:logged_out');
        console.log('\n✗ Logged out. Delete data/channels/whatsapp/auth/ and try again.');
        process.exit(1);
      } else if (reason === DisconnectReason.timedOut) {
        fs.writeFileSync(STATUS_FILE, 'failed:qr_timeout');
        console.log('\n✗ QR code timed out. Please try again.');
        process.exit(1);
      } else if (reason === 515) {
        console.log('\n⟳ Stream error (515) after pairing — reconnecting...');
        connectSocket(phoneNumber);
      } else {
        fs.writeFileSync(STATUS_FILE, `failed:${reason || 'unknown'}`);
        console.log('\n✗ Connection failed. Please try again.');
        process.exit(1);
      }
    }

    if (connection === 'open') {
      fs.writeFileSync(STATUS_FILE, 'authenticated');
      try { fs.unlinkSync(QR_FILE); } catch {}
      // Drain pending long-polls so any open browser tab redirects to
      // /authenticated. Defer server close so the redirect target can load.
      notifyQRWatchers();
      console.log('\n✓ Successfully authenticated with WhatsApp!');
      console.log('  Credentials saved to data/channels/whatsapp/auth/');
      console.log('  You can now start the NanoClaw service.\n');
      setTimeout(() => {
        if (qrServer) { qrServer.close(); qrServer = null; }
        process.exit(0);
      }, 3000);
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

async function authenticate() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  try { fs.unlinkSync(QR_FILE); } catch {}
  try { fs.unlinkSync(STATUS_FILE); } catch {}

  let phoneNumber = phoneArg;
  if (usePairingCode && !phoneNumber) {
    phoneNumber = await askQuestion('Enter your phone number (with country code, no + or spaces, e.g. 14155551234): ');
  }

  console.log('Starting WhatsApp authentication...\n');
  await connectSocket(phoneNumber);
}

authenticate().catch((err) => {
  console.error('Authentication failed:', err.message);
  process.exit(1);
});
