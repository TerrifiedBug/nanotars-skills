#!/usr/bin/env bash
# Re-authenticate gog CLI on a headless server.
# Usage: ./plugins/calendar/scripts/gog-reauth.sh [email] [--services calendar,gmail]
#        ./plugins/calendar/scripts/gog-reauth.sh --check
#        ./plugins/calendar/scripts/gog-reauth.sh --all
#        ./plugins/calendar/scripts/gog-reauth.sh user@gmail.com --redirect-file /tmp/gog-redirect.txt
#
# Discovers all GOG accounts across group .env files, tests each one,
# and re-authenticates expired tokens via expect (headless OAuth flow).

set -euo pipefail
cd "$(dirname "$0")/../../.."

MODE="single"
EMAIL=""
SERVICES=""
REDIRECT_FILE=""
OAUTH_URL_FILE=""

usage() {
  cat <<EOF
Usage:
  $0 --check
  $0 --all [--services calendar,gmail]
  $0 [email] [--services calendar,gmail]
  $0 [email] [--services calendar,gmail] --redirect-file /path/to/redirect.txt

Options:
  --check                 Test configured accounts without changing credentials.
  --all                   Re-authenticate every expired account.
  --services LIST         OAuth services to request. Defaults to calendar,gmail when
                          the gmail plugin is installed, otherwise calendar.
  --redirect-file PATH    Non-interactive mode. Wait for this file to contain the
                          pasted Google redirect URL instead of reading stdin.
  --oauth-url-file PATH   Also write the generated OAuth URL to this file.
EOF
}

read_env_value() {
  local key="$1"
  local file="$2"
  grep "^${key}=" "$file" 2>/dev/null | head -1 | cut -d'=' -f2- || true
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --check)
        MODE="check"
        shift
        ;;
      --all)
        MODE="all"
        shift
        ;;
      --services)
        [ "${2:-}" ] || { echo "ERROR: --services needs a value" >&2; usage; exit 2; }
        SERVICES="$2"
        shift 2
        ;;
      --services=*)
        SERVICES="${1#--services=}"
        shift
        ;;
      --redirect-file)
        [ "${2:-}" ] || { echo "ERROR: --redirect-file needs a path" >&2; usage; exit 2; }
        REDIRECT_FILE="$2"
        shift 2
        ;;
      --redirect-file=*)
        REDIRECT_FILE="${1#--redirect-file=}"
        shift
        ;;
      --oauth-url-file)
        [ "${2:-}" ] || { echo "ERROR: --oauth-url-file needs a path" >&2; usage; exit 2; }
        OAUTH_URL_FILE="$2"
        shift 2
        ;;
      --oauth-url-file=*)
        OAUTH_URL_FILE="${1#--oauth-url-file=}"
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      --*)
        echo "ERROR: Unknown option: $1" >&2
        usage
        exit 2
        ;;
      *)
        if [ -n "$EMAIL" ]; then
          echo "ERROR: Multiple account arguments: $EMAIL and $1" >&2
          usage
          exit 2
        fi
        EMAIL="$1"
        shift
        ;;
    esac
  done
}

default_services() {
  if [ -n "$SERVICES" ]; then
    echo "$SERVICES"
  elif [ -d plugins/gmail ]; then
    echo "calendar,gmail"
  else
    echo "calendar"
  fi
}

# --- Account Discovery ---

discover_accounts() {
  declare -gA ACCOUNTS
  declare -gA ACCOUNT_KEYS

  for f in groups/*/.env .env; do
    [ -f "$f" ] || continue
    local acct
    acct="$(read_env_value GOG_ACCOUNT "$f")"
    [ -n "$acct" ] || continue
    ACCOUNTS["$acct"]="$f"

    local kp
    kp="$(read_env_value GOG_KEYRING_PASSWORD "$f")"
    if [ -z "$kp" ]; then
      for kf in groups/*/.env .env; do
        [ -f "$kf" ] || continue
        kp="$(read_env_value GOG_KEYRING_PASSWORD "$kf")"
        [ -n "$kp" ] && break
      done
    fi
    ACCOUNT_KEYS["$acct"]="$kp"
  done
}

register_account_from_env() {
  local email="$1"
  local f kp

  for f in groups/*/.env .env; do
    [ -f "$f" ] || continue
    if [ "$(read_env_value GOG_ACCOUNT "$f")" = "$email" ]; then
      ACCOUNTS["$email"]="$f"
      kp="$(read_env_value GOG_KEYRING_PASSWORD "$f")"
      if [ -z "$kp" ]; then
        for kf in groups/*/.env .env; do
          [ -f "$kf" ] || continue
          kp="$(read_env_value GOG_KEYRING_PASSWORD "$kf")"
          [ -n "$kp" ] && break
        done
      fi
      ACCOUNT_KEYS["$email"]="$kp"
      return 0
    fi
  done

  return 1
}

check_account() {
  local email="$1"
  local kp="${ACCOUNT_KEYS[$email]:-}"
  GOG_KEYRING_PASSWORD="$kp" gog calendar calendars --account "$email" >/dev/null 2>&1
}

sync_gogcli() {
  if [ ! -d "$HOME/.config/gogcli" ]; then
    echo "WARNING: $HOME/.config/gogcli does not exist; nothing to sync."
    return 0
  fi

  echo "Syncing credentials to container mount..."
  mkdir -p data/gogcli
  cp -a "$HOME/.config/gogcli/." data/gogcli/
  chown -R 1000:1000 data/gogcli/
}

print_check() {
  discover_accounts
  if [ "${#ACCOUNTS[@]}" -eq 0 ]; then
    echo "No GOG accounts configured."
    exit 0
  fi

  echo "Checking ${#ACCOUNTS[@]} Google account(s)..."
  echo ""
  local expired=0
  local acct
  for acct in "${!ACCOUNTS[@]}"; do
    if check_account "$acct"; then
      echo "  OK      $acct (${ACCOUNTS[$acct]})"
    else
      echo "  EXPIRED $acct (${ACCOUNTS[$acct]})"
      expired=$((expired + 1))
    fi
  done
  echo ""

  if [ "$expired" -eq 0 ]; then
    echo "All accounts healthy."
  else
    echo "$expired account(s) need re-authentication."
    echo "Run: $0 --all"
    echo "  or: $0 <email>"
  fi
  exit "$expired"
}

wait_for_file_content() {
  local file="$1"
  local label="$2"
  local waited=0

  while [ ! -s "$file" ]; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -gt 300 ]; then
      echo "ERROR: Timed out waiting for $label" >&2
      return 1
    fi
  done
}

reauth_account() {
  local email="$1"
  local services="$2"
  local kp="${ACCOUNT_KEYS[$email]:-}"
  local temp_redirect_file=""
  local redirect_path="$REDIRECT_FILE"
  local oauth_url_path="$OAUTH_URL_FILE"
  local expect_script oauth_url result

  if [ -z "$kp" ]; then
    echo "ERROR: GOG_KEYRING_PASSWORD not found for $email"
    return 1
  fi

  if ! command -v expect >/dev/null 2>&1; then
    echo "ERROR: expect is required for headless gog re-authentication"
    return 1
  fi

  export GOG_KEYRING_PASSWORD="$kp"
  echo "Re-authenticating: $email (services: $services)"
  echo ""

  expect_script="$(mktemp)"
  if [ -z "$redirect_path" ]; then
    temp_redirect_file="$(mktemp)"
    rm -f "$temp_redirect_file"
    redirect_path="$temp_redirect_file"
  fi
  if [ -z "$oauth_url_path" ]; then
    oauth_url_path="$(mktemp)"
  else
    rm -f "$oauth_url_path"
  fi

  cat > "$expect_script" <<'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 300
set email [lindex $argv 0]
set services [lindex $argv 1]
set oauth_url_file [lindex $argv 2]
set redirect_file [lindex $argv 3]

spawn gog auth add $email --manual --services=$services --force-consent

expect -re {(https://accounts\.google\.com/o/oauth2[^ \r\n]+)}
set oauth_url $expect_out(1,string)

set f [open $oauth_url_file w]
puts $f $oauth_url
close $f

expect "Paste redirect URL"

set waited 0
while {![file exists $redirect_file] || [file size $redirect_file] == 0} {
    sleep 1
    incr waited
    if {$waited > 300} {
        puts "\nTimeout waiting for redirect URL"
        exit 1
    }
}
after 200

set rf [open $redirect_file r]
set url [gets $rf]
close $rf

send "$url\r"
expect eof

lassign [wait] pid spawnid os_error value
exit $value
EXPECT_EOF
  chmod +x "$expect_script"

  cleanup_reauth() {
    rm -f "$expect_script"
    if [ -n "$temp_redirect_file" ]; then
      rm -f "$temp_redirect_file"
    fi
    if [ -z "$OAUTH_URL_FILE" ]; then
      rm -f "$oauth_url_path"
    fi
  }

  "$expect_script" "$email" "$services" "$oauth_url_path" "$redirect_path" &
  local expect_pid=$!

  if ! wait_for_file_content "$oauth_url_path" "OAuth URL"; then
    kill "$expect_pid" 2>/dev/null || true
    wait "$expect_pid" 2>/dev/null || true
    cleanup_reauth
    return 1
  fi

  oauth_url="$(cat "$oauth_url_path")"
  echo "========================================="
  echo "Open this URL in your browser:"
  echo ""
  echo "$oauth_url"
  echo ""
  echo "After authorizing, paste the redirect URL below:"
  echo "========================================="
  echo ""

  if [ -n "$REDIRECT_FILE" ]; then
    echo "Waiting for redirect URL in: $REDIRECT_FILE"
  else
    read -r redirect_url
    printf '%s\n' "$redirect_url" > "$redirect_path"
  fi

  set +e
  wait "$expect_pid"
  result=$?
  set -e
  cleanup_reauth

  if [ "$result" -ne 0 ]; then
    echo ""
    echo "ERROR: Authentication failed for $email (exit code $result)"
    return 1
  fi

  echo ""
  echo "Authenticated successfully: $email"
  return 0
}

choose_account() {
  if [ -n "$EMAIL" ]; then
    echo "$EMAIL"
    return 0
  fi

  if [ "${#ACCOUNTS[@]}" -eq 1 ]; then
    printf '%s\n' "${!ACCOUNTS[@]}"
    return 0
  fi

  local expired_accounts=()
  local acct

  echo "Checking accounts..." >&2
  for acct in "${!ACCOUNTS[@]}"; do
    if check_account "$acct"; then
      echo "  OK      $acct" >&2
    else
      echo "  EXPIRED $acct" >&2
      expired_accounts+=("$acct")
    fi
  done
  echo "" >&2

  if [ "${#expired_accounts[@]}" -eq 0 ]; then
    echo "All accounts healthy. Nothing to do." >&2
    exit 0
  elif [ "${#expired_accounts[@]}" -eq 1 ]; then
    echo "Re-authenticating the one expired account..." >&2
    printf '%s\n' "${expired_accounts[0]}"
    return 0
  fi

  echo "Multiple expired accounts. Choose one:" >&2
  local i=1
  for acct in "${expired_accounts[@]}"; do
    echo "  $i) $acct (${ACCOUNTS[$acct]})" >&2
    i=$((i + 1))
  done
  echo "  a) All expired accounts" >&2
  echo "" >&2
  read -rp "Choice: " choice

  if [ "$choice" = "a" ] || [ "$choice" = "A" ]; then
    printf '%s\n' "__ALL_EXPIRED__"
    EXPIRED_SELECTION=("${expired_accounts[@]}")
    return 0
  fi

  i=1
  for acct in "${expired_accounts[@]}"; do
    if [ "$i" -eq "$choice" ] 2>/dev/null; then
      printf '%s\n' "$acct"
      return 0
    fi
    i=$((i + 1))
  done

  echo "ERROR: Invalid choice" >&2
  return 1
}

parse_args "$@"
SERVICES="$(default_services)"

if [ "$MODE" = "check" ]; then
  print_check
fi

discover_accounts

if [ "${#ACCOUNTS[@]}" -eq 0 ]; then
  echo "ERROR: No GOG_ACCOUNT found in any groups/*/.env or .env"
  usage
  exit 1
fi

if [ "$MODE" = "all" ]; then
  echo "Checking all accounts..."
  expired_accounts=()
  for acct in "${!ACCOUNTS[@]}"; do
    if check_account "$acct"; then
      echo "  OK      $acct; skipping"
    else
      echo "  EXPIRED $acct; will reauth"
      expired_accounts+=("$acct")
    fi
  done

  if [ "${#expired_accounts[@]}" -eq 0 ]; then
    echo ""
    echo "All accounts healthy. Nothing to do."
    exit 0
  fi

  echo ""
  echo "${#expired_accounts[@]} account(s) to re-authenticate."
  echo ""

  failures=0
  for acct in "${expired_accounts[@]}"; do
    reauth_account "$acct" "$SERVICES" || failures=$((failures + 1))
    echo ""
  done

  sync_gogcli
  exit "$failures"
fi

declare -a EXPIRED_SELECTION=()
selected_account="$(choose_account)"

if [ "$selected_account" = "__ALL_EXPIRED__" ]; then
  failures=0
  for acct in "${EXPIRED_SELECTION[@]}"; do
    reauth_account "$acct" "$SERVICES" || failures=$((failures + 1))
    echo ""
  done
  sync_gogcli
  exit "$failures"
fi

EMAIL="$selected_account"

if [ -z "${ACCOUNTS[$EMAIL]+x}" ]; then
  if ! register_account_from_env "$EMAIL"; then
    echo "ERROR: Account '$EMAIL' not found in any .env file"
    exit 1
  fi
fi

reauth_account "$EMAIL" "$SERVICES"
sync_gogcli

echo ""
echo "Verifying..."
GOG_KEYRING_PASSWORD="${ACCOUNT_KEYS[$EMAIL]}" gog calendar calendars --account "$EMAIL" 2>&1
