---
name: add-skill-gmail
description: Add Gmail access to NanoTars via gog CLI (Google Workspace CLI). Agents can search, read, and send emails. Shares OAuth credentials with Google Calendar if already configured. Triggers on "add gmail", "gmail setup", "gmail integration", "email setup".
---

# Add Gmail (gog CLI)

Configures Gmail access for agent containers using the `gog` CLI, the same tool used for Google Calendar. If the user already has Calendar set up via `/add-skill-calendar`, Gmail just needs the scope added.

**Mode:** Tool Mode only -- agents can read/send emails when triggered from a channel (e.g., "check my email", "send an email to..."). This is NOT a channel (emails don't trigger the agent).

## Preflight

Before installing, verify NanoTars is set up:

```bash
[ -d node_modules ] && echo "DEPS: ok" || echo "DEPS: missing"
docker image inspect nanoclaw-agent:latest &>/dev/null && echo "IMAGE: ok" || echo "IMAGE: not built"
if grep -q "ANTHROPIC_API_KEY\|CLAUDE_CODE_OAUTH_TOKEN" .env 2>/dev/null || [ -f "$HOME/.claude/.credentials.json" ]; then echo "AUTH: ok"; else echo "AUTH: missing"; fi
```

If any check fails, tell the user to run `/nanotars-setup` first and stop.

## Prerequisites

- A Google account with Gmail

## Step 1: Check Existing Configuration

```bash
which gog && echo "GOG_INSTALLED" || echo "GOG_MISSING"
grep "^GOG_KEYRING_PASSWORD=" .env 2>/dev/null && echo "GOG_CONFIGURED" || echo "GOG_NOT_CONFIGURED"
[ -d plugins/gmail ] && echo "PLUGIN_EXISTS" || echo "PLUGIN_MISSING"
[ -d data/gogcli ] && echo "GOG_CREDS_EXIST" || echo "GOG_CREDS_MISSING"
```

**If gog is already installed and configured** (Calendar is set up via `/add-skill-calendar`):
- Skip to Step 3 to add Gmail scopes
- The same OAuth credentials and gog config are reused

**If gog is not installed:**
- Continue with Step 2

## Step 2: Install gog and Set Up OAuth

**Only needed if `/add-skill-calendar` hasn't been run yet.**

Install gog:
```bash
which gog && echo "Already installed" || curl -sL "https://github.com/steipete/gogcli/releases/download/v0.9.0/gogcli_0.9.0_linux_amd64.tar.gz" | tar -xz -C /usr/local/bin gog
```

**USER ACTION REQUIRED**

Tell the user:

> I need you to set up Google Cloud OAuth credentials:
>
> 1. Go to https://console.cloud.google.com
> 2. Create a new project (or select an existing one)
> 3. Go to **APIs & Services > Library**, search for **Gmail API**, and **Enable** it
> 4. Go to **APIs & Services > Credentials**
> 5. Click **+ CREATE CREDENTIALS > OAuth client ID**
> 6. If prompted for consent screen, choose "External", fill in app name, save
> 7. Application type: **Desktop app**, name it anything
> 8. Click **Create**, then **DOWNLOAD JSON**
> 9. Tell me where you saved the file

Import the credentials:
```bash
gog auth credentials /path/to/client_secret.json
```

Set keyring password:
```bash
grep "^GOG_KEYRING_PASSWORD=" .env 2>/dev/null && echo "ALREADY_SET" || echo 'GOG_KEYRING_PASSWORD=CHOOSE_A_PASSWORD' >> .env
```

Optionally set `GOG_ACCOUNT` if the user has multiple Google accounts (gog defaults to the first):
```bash
echo 'GOG_ACCOUNT=user@gmail.com' >> .env
```

## Step 3: Enable Gmail API and Authorize

**If gog was already set up for Calendar (via /add-cal):**

Tell the user:

> You already have a GCP project from Calendar setup. I just need you to enable the Gmail API in that same project:
>
> 1. Go to https://console.cloud.google.com
> 2. Select your existing project (the one used for Calendar)
> 3. Go to **APIs & Services > Library**
> 4. Search for **Gmail API** and click **Enable**
> 5. Let me know when done

Wait for confirmation, then re-auth with both scopes. gog stores one token per account — re-authing with expanded scopes replaces the old token. Google will prompt the user to grant the additional Gmail permission:

```bash
if [ -x plugins/calendar/scripts/gog-reauth.sh ]; then
  ./plugins/calendar/scripts/gog-reauth.sh --services calendar,gmail
else
  GOG_KEYRING_PASSWORD=$(grep GOG_KEYRING_PASSWORD .env | cut -d'=' -f2) gog auth login --services gmail,calendar
fi
```

On a headless server (no browser), prefer the calendar helper if it is installed:
```bash
if [ -x plugins/calendar/scripts/gog-reauth.sh ]; then
  ./plugins/calendar/scripts/gog-reauth.sh --services calendar,gmail
else
  GOG_KEYRING_PASSWORD=$(grep GOG_KEYRING_PASSWORD .env | cut -d'=' -f2) gog auth login --services gmail,calendar --manual
fi
```

This prints an OAuth URL. Tell the user to open it in any browser, authorize the expanded permissions, then paste back the redirect URL.

**If this is a fresh gog setup (Step 2 was completed):**

```bash
GOG_KEYRING_PASSWORD=$(grep GOG_KEYRING_PASSWORD .env | cut -d'=' -f2) gog auth login --services gmail
```

Verify Gmail access:
```bash
GOG_KEYRING_PASSWORD=$(grep GOG_KEYRING_PASSWORD .env | cut -d'=' -f2) gog gmail labels list
```

## Step 4: Sync Credentials for Containers

```bash
mkdir -p data/gogcli
cp -a ~/.config/gogcli/. data/gogcli/
chown -R 1000:1000 data/gogcli
```

## Step 5: Plugin Configuration

Ask the user which groups should have access to Gmail:

- **All groups** (default) -- every group's agent can read and send emails
- **Specific groups only** -- e.g., only `main`

If the user wants to restrict access, update `plugins/gmail/plugin.json` after copying (Step 6) to set `"groups"` to the list of group folder names:

```json
"groups": ["main"]
```

If all groups (or the user doesn't care), leave as `"groups": ["*"]`.

Restricting access means only those groups' agents will have Gmail tools. Other groups won't see the email commands or credentials.

Also ask about channel types. If the user wants this plugin available on all channel types (WhatsApp, Discord, etc.), leave `"channels": ["*"]`. To restrict, set `"channels"` to specific types (e.g., `["whatsapp"]`). Most users will want the default.

## Step 6: Install Plugin

```bash
cp -r ${CLAUDE_PLUGIN_ROOT}/files/ plugins/gmail/
```

## Step 7: Allow the Mount Path

The runtime silently rejects container mounts not covered by `~/.config/nanotars/mount-allowlist.json`. Gmail mounts `data/gogcli` (shared with the calendar plugin if installed). Check whether it's already covered:

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

If `COVERED`, skip ahead. Otherwise tell the user:

> Gmail needs `~/nanotars/data/gogcli` added to the mount allowlist (`~/.config/nanotars/mount-allowlist.json`). I'll add a tightly-scoped entry — only this directory will be mountable, no broader access. OK?

After confirmation:

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
  description: "gmail/calendar plugin gogcli OAuth state"
});
fs.writeFileSync(allowlistPath, JSON.stringify(list, null, 2) + "\n");
JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
console.log("ALLOWLIST_UPDATED");
'
```

## Step 8: Build and Restart

```bash
./container/build.sh && npm run build
nanotars restart 2>/dev/null || echo "Restart the NanoTars service manually"
```

After restart, remove any stale agent containers so the next message spawns a fresh one with the new mount applied:

```bash
docker ps --format '{{.Names}}' | grep '^nanoclaw-' | xargs -r docker rm -f
```

## Verify

Send a message in your channel like:
- "Check my recent emails"
- "Search my inbox for messages from John"
- "Send an email to jane@example.com about the meeting"

## Troubleshooting

- **"invalid_grant" / token expired**: Re-run Step 3 to re-authorize, then Step 4 to sync credentials
- **gog works on host but not in container**: Credentials not synced -- run Step 4 again
- **"GOG_KEYRING_PASSWORD not set"**: Check it's in `.env` and the plugin's `containerEnvVars` includes it
- **Gmail commands fail but Calendar works**: Gmail scopes not authorized -- re-run Step 3 with `--services calendar,gmail`

## Existing Installation (Per-Group Credentials)

If this plugin is already installed and you want **different credentials for a specific group** (e.g., a work account for one group, personal for another):

1. Check which groups exist:
   ```bash
   ls -d groups/*/
   ```

2. Ask the user which group should get separate credentials.

3. Collect the new GOG credentials for that group.

4. Write to the group's `.env` file (creates if needed):
   ```bash
   echo 'GOG_KEYRING_PASSWORD=new-password' >> groups/{folder}/.env
   echo 'GOG_ACCOUNT=other@gmail.com' >> groups/{folder}/.env
   ```
   These values override the global `.env` for that group's containers only.

5. Restart NanoTars:
   ```bash
   nanotars restart
   ```

## Remove

1. `rm -rf plugins/gmail/`
2. Rebuild and restart
3. Gmail scopes remain in the OAuth token but are harmless; to fully revoke, re-auth with `--services calendar` only
