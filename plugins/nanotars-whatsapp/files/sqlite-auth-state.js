/**
 * SQLite-backed auth state for Baileys.
 * Drop-in replacement for useMultiFileAuthState that stores all keys
 * in a single auth.db file instead of thousands of individual JSON files.
 *
 * On first run, migrates existing JSON files into the database and
 * moves them to a json-backup/ subdirectory.
 *
 * Requires better-sqlite3 (provided by root project).
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';

// Ordered longest-prefix-first so greedy match picks the right type.
const KEY_TYPE_PREFIXES = [
  'sender-key-memory-',
  'app-state-sync-version-',
  'app-state-sync-key-',
  'sender-key-',
  'device-list-',
  'lid-mapping-',
  'pre-key-',
  'session-',
  'tctoken-',
];

/**
 * Parse a Baileys auth JSON filename into { type, id }.
 * Reverses the fixFileName encoding: __ → / and - → :
 * (Baileys' fixFileName replaces / with __ and : with -)
 */
function parseKeyFilename(basename) {
  for (const prefix of KEY_TYPE_PREFIXES) {
    if (basename.startsWith(prefix)) {
      const type = prefix.slice(0, -1); // strip trailing dash
      const encodedId = basename.slice(prefix.length);
      const id = encodedId.replace(/__/g, '/').replace(/-/g, ':');
      return { type, id };
    }
  }
  return null;
}

/**
 * Migrate existing JSON auth files into the SQLite database.
 * Only runs when creds.json exists (i.e., first run after upgrade).
 * Moves migrated files to json-backup/ for safety.
 */
function migrateFromJsonFiles(db, folder, logger) {
  const credsPath = path.join(folder, 'creds.json');
  if (!fs.existsSync(credsPath)) return;

  const files = fs.readdirSync(folder).filter(f => f.endsWith('.json'));
  if (files.length === 0) return;

  logger?.info({ count: files.length }, 'Migrating auth JSON files to SQLite');

  const setKeyStmt = db.prepare(
    'INSERT OR REPLACE INTO signal_keys (type, id, value) VALUES (?, ?, ?)',
  );
  const saveCredsStmt = db.prepare(
    'INSERT OR REPLACE INTO creds (id, data) VALUES (?, ?)',
  );

  let migrated = 0;
  let skipped = 0;

  db.transaction(() => {
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(folder, file), 'utf8');

        if (file === 'creds.json') {
          saveCredsStmt.run('main', content);
          migrated++;
          continue;
        }

        const parsed = parseKeyFilename(file.slice(0, -5)); // strip .json
        if (parsed) {
          setKeyStmt.run(parsed.type, parsed.id, content);
          migrated++;
        } else {
          skipped++;
          logger?.warn({ file }, 'Skipping unrecognized auth file');
        }
      } catch (err) {
        skipped++;
        logger?.warn({ file, err: err.message }, 'Failed to migrate auth file');
      }
    }
  })();

  // Move originals to backup directory
  const backupDir = path.join(folder, 'json-backup');
  fs.mkdirSync(backupDir, { recursive: true });
  let moved = 0;
  for (const file of files) {
    try {
      fs.renameSync(path.join(folder, file), path.join(backupDir, file));
      moved++;
    } catch {}
  }

  logger?.info(
    { migrated, skipped, movedToBackup: moved },
    'Auth migration to SQLite complete',
  );
}

/**
 * Create a SQLite-backed auth state compatible with Baileys.
 * @param {string} folder  Directory for auth.db (and legacy JSON files)
 * @param {object} [logger]  Pino-compatible logger
 * @returns {{ state: AuthenticationState, saveCreds: () => void }}
 */
export async function useSqliteAuthState(folder, logger) {
  fs.mkdirSync(folder, { recursive: true });

  const dbPath = path.join(folder, 'auth.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS creds (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS signal_keys (
      type TEXT NOT NULL,
      id TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (type, id)
    );
  `);

  migrateFromJsonFiles(db, folder, logger);

  // Load existing credentials or create fresh ones
  const credsRow = db.prepare('SELECT data FROM creds WHERE id = ?').get('main');
  const creds = credsRow
    ? JSON.parse(credsRow.data, BufferJSON.reviver)
    : initAuthCreds();

  // Prepared statements
  const getKeyStmt = db.prepare(
    'SELECT value FROM signal_keys WHERE type = ? AND id = ?',
  );
  const setKeyStmt = db.prepare(
    'INSERT OR REPLACE INTO signal_keys (type, id, value) VALUES (?, ?, ?)',
  );
  const delKeyStmt = db.prepare(
    'DELETE FROM signal_keys WHERE type = ? AND id = ?',
  );
  const saveCredsStmt = db.prepare(
    'INSERT OR REPLACE INTO creds (id, data) VALUES (?, ?)',
  );

  return {
    state: {
      creds,
      keys: {
        get(type, ids) {
          const result = {};
          for (const id of ids) {
            const row = getKeyStmt.get(type, id);
            if (row) {
              let value = JSON.parse(row.value, BufferJSON.reviver);
              if (type === 'app-state-sync-key') {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              result[id] = value;
            }
          }
          return result;
        },

        set(data) {
          db.transaction(() => {
            for (const type of Object.keys(data)) {
              for (const [id, value] of Object.entries(data[type])) {
                if (value === null) {
                  delKeyStmt.run(type, id);
                } else {
                  setKeyStmt.run(
                    type, id,
                    JSON.stringify(value, BufferJSON.replacer),
                  );
                }
              }
            }
          })();
        },
      },
    },

    saveCreds: () => {
      saveCredsStmt.run('main', JSON.stringify(creds, BufferJSON.replacer));
    },
  };
}
