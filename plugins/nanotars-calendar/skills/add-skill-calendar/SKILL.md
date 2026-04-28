---
name: add-calendar
description: Add calendar access to NanoTars. Supports Google Calendar (gog CLI with OAuth) and CalDAV providers (iCloud, Nextcloud, Fastmail via cal CLI). Guides through authentication and configures environment variables. Triggers on "add calendar", "add caldav", "icloud calendar", "google calendar", "calendar setup".
---

# Add Calendar Access

Calendar integration for NanoTars agent containers. Two tools are available:

- **`gog`** -- Google Calendar (OAuth, read/write)
- **`cal`** -- CalDAV providers: iCloud, Nextcloud, Fastmail (Basic Auth, read/write)

## Preflight

Before installing, verify NanoTars is set up:

```bash
[ -d node_modules ] && echo "DEPS: ok" || echo "DEPS: missing"
docker image inspect nanoclaw-agent:latest &>/dev/null && echo "IMAGE: ok" || echo "IMAGE: not built"
if grep -q "ANTHROPIC_API_KEY\|CLAUDE_CODE_OAUTH_TOKEN" .env 2>/dev/null || [ -f "$HOME/.claude/.credentials.json" ]; then echo "AUTH: ok"; else echo "AUTH: missing"; fi
```

If any check fails, tell the user to run `/nanotars-setup` first and stop.

## Prerequisites

## Install

1. Check existing configuration (credentials may be in global `.env` or any group's `groups/*/.env`):
   ```bash
   (grep -rq "^GOG_KEYRING_PASSWORD=" .env groups/*/.env 2>/dev/null) && echo "GOOGLE: CONFIGURED" || echo "GOOGLE: NOT SET"
   (grep -rq "^CALDAV_ACCOUNTS=" .env groups/*/.env 2>/dev/null) && echo "CALDAV: CONFIGURED" || echo "CALDAV: NOT SET"
   ```
   If already configured, ask the user if they want to add another provider or reconfigure.

2. Choose provider:
   - **Google Calendar** -- Go to Step 3A
   - **iCloud / Nextcloud / Fastmail / Other CalDAV** -- Go to Step 3B

### Step 3A: Google Calendar (gog CLI)

Install gog on the host if needed:
```bash
which gog && echo "GOG_INSTALLED" || curl -sL "https://github.com/steipete/gogcli/releases/download/v0.9.0/gogcli_0.9.0_linux_amd64.tar.gz" | tar -xz -C /usr/local/bin gog
```

gogcli is installed automatically when the container image is built (via `plugins/calendar/Dockerfile.partial`). No manual Dockerfile changes needed.

Import OAuth credentials (user provides their client_secret.json path):
```bash
gog auth credentials /path/to/client_secret.json
```

OAuth login (include gmail if the Gmail plugin is already installed to preserve its scopes):
```bash
if [ -d plugins/gmail ]; then
  GOG_KEYRING_PASSWORD=$(grep GOG_KEYRING_PASSWORD .env | cut -d'=' -f2) gog auth login --services calendar,gmail
else
  GOG_KEYRING_PASSWORD=$(grep GOG_KEYRING_PASSWORD .env | cut -d'=' -f2) gog auth login --services calendar
fi
```

On a headless server, add `--manual` to the gog command above.

Verify: `GOG_KEYRING_PASSWORD=$(grep GOG_KEYRING_PASSWORD .env | cut -d'=' -f2) gog calendar calendars`

Configure environment:
```bash
grep "^GOG_KEYRING_PASSWORD=" .env 2>/dev/null && echo "ALREADY_SET" || echo 'GOG_KEYRING_PASSWORD=THEIR_PASSWORD_HERE' >> .env
```

Copy gog config for containers:
```bash
mkdir -p data/gogcli
cp -r ~/.config/gogcli/* data/gogcli/
chown -R 1000:1000 data/gogcli
```

### Step 3B: CalDAV (iCloud, Nextcloud, Fastmail)

Gather account details:
- **Provider name** (e.g., "iCloud", "Nextcloud", "Fastmail")
- **CalDAV server URL**:
  - iCloud: `https://caldav.icloud.com`
  - Nextcloud: `https://YOUR_SERVER/remote.php/dav`
  - Fastmail: `https://caldav.fastmail.com`
- **Username** (usually email address)
- **App-specific password**

App-specific password instructions:

**iCloud:**
> 1. Go to https://appleid.apple.com/account/manage
> 2. Sign in > "Sign-In and Security" > "App-Specific Passwords"
> 3. Click + > Name it "NanoTars" > Create
> 4. Copy the password (format: xxxx-xxxx-xxxx-xxxx)

**Nextcloud:**
> 1. Settings > Security > "Devices & Sessions"
> 2. Enter "NanoTars" > "Create new app password"

**Fastmail:**
> 1. Settings > Privacy & Security > Integrations
> 2. "New app password" > Select CalDAV > Name it "NanoTars"

Save to `.env`:
```bash
sed -i '/^CALDAV_ACCOUNTS=/d' .env
echo 'CALDAV_ACCOUNTS=[{"name":"iCloud","serverUrl":"https://caldav.icloud.com","user":"user@icloud.com","pass":"xxxx-xxxx-xxxx-xxxx"}]' >> .env
```

### Step 4: Group Scoping

Ask the user which groups should have access to Calendar:

- **All groups** (default) -- every group's agent can read and manage calendar events
- **Specific groups only** -- e.g., only `main` and `family-chat`

If the user wants to restrict access, update `plugins/calendar/plugin.json` after copying (Step 5) to set `"groups"` to the list of group folder names:

```json
"groups": ["main", "family-chat"]
```

If all groups (or the user doesn't care), leave as `"groups": ["*"]`.

Restricting access means only those groups' agents will have calendar tools. Other groups won't see calendar commands or credentials.

### Step 5: Deploy Plugin

Copy plugin files:
```bash
mkdir -p plugins/calendar/container-skills plugins/calendar/cal-cli/src plugins/calendar/scripts
cp ${CLAUDE_PLUGIN_ROOT}/files/plugin.json plugins/calendar/
cp ${CLAUDE_PLUGIN_ROOT}/files/container-skills/SKILL.md plugins/calendar/container-skills/
cp ${CLAUDE_PLUGIN_ROOT}/files/Dockerfile.partial plugins/calendar/
cp ${CLAUDE_PLUGIN_ROOT}/files/package.json ${CLAUDE_PLUGIN_ROOT}/files/package-lock.json ${CLAUDE_PLUGIN_ROOT}/files/tsconfig.json plugins/calendar/cal-cli/
cp ${CLAUDE_PLUGIN_ROOT}/files/src/*.ts plugins/calendar/cal-cli/src/
cp ${CLAUDE_PLUGIN_ROOT}/files/scripts/gog-reauth.sh plugins/calendar/scripts/ && chmod +x plugins/calendar/scripts/gog-reauth.sh
```

### Step 6: Configure Container Mounts

The only mount needed is the gogcli config directory so the container can access Google OAuth tokens:

```bash
NANOCLAW_DIR=$(pwd)
cat > plugins/calendar/plugin.json << EOF
{
  "name": "calendar",
  "description": "Calendar access via gog CLI and CalDAV",
  "containerEnvVars": ["GOG_KEYRING_PASSWORD", "GOG_ACCOUNT", "CALDAV_ACCOUNTS"],
  "containerMounts": [
    {"hostPath": "data/gogcli", "containerPath": "/home/node/.config/gogcli"}
  ],
  "hooks": []
}
EOF
```

### Step 7: Allow the Mount Path

The runtime silently rejects container mounts not covered by `~/.config/nanotars/mount-allowlist.json`. Check whether `data/gogcli` is already covered:

```bash
node -e '
const fs = require("fs"), path = require("path");
const home = process.env.HOME;
const allowlistPath = path.join(home, ".config/nanotars/mount-allowlist.json");
const expand = (p) => p.startsWith("~/") ? path.join(home, p.slice(2)) : path.resolve(p);
const target = path.resolve("data/gogcli");
if (!fs.existsSync(allowlistPath)) { console.log("MISSING_ALLOWLIST"); process.exit(0); }
const list = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
const covered = (list.allowedRoots || []).some(r => {
  const a = expand(r.path);
  return target === a || target.startsWith(a + "/");
});
console.log(covered ? "COVERED" : "NEEDS_ALLOWLIST_ENTRY");
'
```

If output is `COVERED`, skip to the next step. If `NEEDS_ALLOWLIST_ENTRY` or `MISSING_ALLOWLIST`, tell the user:

> Calendar needs `~/nanotars/data/gogcli` added to the mount allowlist (`~/.config/nanotars/mount-allowlist.json`). I'll add a tightly-scoped entry — only this directory will be mountable, no broader access. OK?

After confirmation, append the entry (creating the file if missing):

```bash
node -e '
const fs = require("fs"), path = require("path");
const allowlistPath = path.join(process.env.HOME, ".config/nanotars/mount-allowlist.json");
fs.mkdirSync(path.dirname(allowlistPath), { recursive: true });
const list = fs.existsSync(allowlistPath)
  ? JSON.parse(fs.readFileSync(allowlistPath, "utf8"))
  : { allowedRoots: [], blockedPatterns: [], nonMainReadOnly: true };
list.allowedRoots = list.allowedRoots || [];
list.allowedRoots.push({
  path: "~/nanotars/data/gogcli",
  allowReadWrite: true,
  description: "calendar plugin gogcli OAuth state"
});
fs.writeFileSync(allowlistPath, JSON.stringify(list, null, 2) + "\n");
JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
console.log("ALLOWLIST_UPDATED");
'
```

### Step 8: Rebuild and Restart

```bash
./container/build.sh
nanotars restart 2>/dev/null || echo "Restart the NanoTars service manually"
```

After restart, also remove any stale agent container so the next message spawns a fresh one with the new mount applied:

```bash
docker ps --format '{{.Names}}' | grep '^nanoclaw-' | xargs -r docker rm -f
```

Confirm no `Plugin mount REJECTED` warnings appear in `logs/nanotars.log` after the next agent run.

## Verify

Tell the user:
> Calendar access is configured. Test via WhatsApp: "list my calendars" or "what's on my calendar today?"

## Refresh Google OAuth Token

Google OAuth tokens expire periodically. When the agent reports `"invalid_grant" "Token has been expired or revoked."`, use the helper script:

```bash
# Check which accounts need reauth (non-destructive)
./plugins/calendar/scripts/gog-reauth.sh --check

# Reauth — auto-detects expired accounts, prompts for selection
./plugins/calendar/scripts/gog-reauth.sh

# Reauth all expired accounts in sequence
./plugins/calendar/scripts/gog-reauth.sh --all

# Reauth a specific account
./plugins/calendar/scripts/gog-reauth.sh user@gmail.com
```

The script automatically:
1. Discovers all `GOG_ACCOUNT` values across `groups/*/.env` and `.env`
2. Tests each account's OAuth token against the Google Calendar API
3. Shows which accounts are healthy (✓) and which are expired (✗)
4. If multiple expired, offers to reauth all or pick specific ones
5. Uses the `GOG_KEYRING_PASSWORD` from the same env file as the account
6. Includes gmail scopes if the gmail plugin is installed
7. Runs `gog auth` via expect (handles the CSRF state matching that breaks with separate invocations)
8. Prompts for the redirect URL interactively
9. Syncs credentials to `data/gogcli/` for container access
10. Verifies each account after reauth

### From Claude Code (non-interactive)

Since Claude Code can't use `read`, run the script in the background and feed the redirect URL via file:

The approach uses `plugins/calendar/scripts/gog-reauth.sh`'s expect script but non-interactively:

1. First, discover which account needs reauth. If the agent reported the error, check which group it was for and find the `GOG_ACCOUNT` in that group's `.env`.

2. Write and run the expect script from `plugins/calendar/scripts/gog-reauth.sh` (the section between `EXPECT_EOF` markers) in the background, passing `$EMAIL`, `$SERVICES`, `$STATE_FILE`, and `$REDIRECT_FILE`.

3. Wait for `$STATE_FILE` to be written (contains the CSRF state token).

4. Show the user the OAuth URL containing the state from `$STATE_FILE`.

5. User authorizes and pastes redirect URL.

6. Write the redirect URL to `$REDIRECT_FILE` — the expect process picks it up and completes auth.

7. Sync: `cp -r ~/.config/gogcli/* data/gogcli/ && chown -R 1000:1000 data/gogcli/`

IMPORTANT: Each `gog auth` invocation generates a unique CSRF state token. The redirect URL from one invocation will NOT work with another — the state must match. This is why the expect approach keeps the same process alive throughout.

## Troubleshooting

- **gog "invalid_grant" / "Token has been expired or revoked"**: Follow the "Refresh Google OAuth Token" section above.
- **gog works on host but not in container**: Credentials not synced — run `cp -r ~/.config/gogcli/* data/gogcli/ && chown -R 1000:1000 data/gogcli/`.
- **gog config not found in container**: Ensure `data/gogcli/` exists and is chowned to 1000:1000.
- **iCloud "401 Unauthorized"**: Use an app-specific password, not your Apple ID password.
- **"CALDAV_ACCOUNTS not defined"**: Check it's in both `.env` and `plugin.json` containerEnvVars.
- **Nextcloud connection refused**: Verify the server URL includes `/remote.php/dav`.

## Existing Installation (Per-Group Credentials)

If this plugin is already installed and you want **different credentials for a specific group** (e.g., a work account for one group, personal for another):

1. Check which groups exist:
   ```bash
   ls -d groups/*/
   ```

2. Ask the user which group should get separate credentials.

3. Collect the new calendar credentials for that group.

4. Write to the group's `.env` file (creates if needed):
   ```bash
   echo 'GOG_KEYRING_PASSWORD=new-password' >> groups/{folder}/.env
   echo 'GOG_ACCOUNT=other@gmail.com' >> groups/{folder}/.env
   echo 'CALDAV_ACCOUNTS=[{"name":"Work","serverUrl":"https://caldav.example.com","user":"work@example.com","pass":"app-password"}]' >> groups/{folder}/.env
   ```
   These values override the global `.env` for that group's containers only.

5. Restart NanoTars:
   ```bash
   nanotars restart
   ```

## Remove

1. `rm -rf plugins/calendar/`
2. Remove env vars from `.env`:
   ```bash
   sed -i '/^GOG_KEYRING_PASSWORD=/d' .env
   sed -i '/^GOG_ACCOUNT=/d' .env
   sed -i '/^CALDAV_ACCOUNTS=/d' .env
   ```
3. `rm -rf data/gogcli`
4. Remove the plugin directory and rebuild the container image:
   ```bash
   ./container/build.sh
   ```
5. Restart the service.
6. Revoke app-specific passwords in provider security settings.
