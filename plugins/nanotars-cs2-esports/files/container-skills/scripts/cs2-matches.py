#!/usr/bin/env python3
"""Fetch upcoming CS2 matches from Liquipedia's API."""

import argparse
import json
import re
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta

API_URL = "https://liquipedia.net/counterstrike/api.php"
USER_AGENT = "nanoclaw-cs2/2.0 (esports-skill; contact: github.com/nanoclaw)"


def fetch_matches_html():
    """Fetch the matches page HTML from Liquipedia's MediaWiki API."""
    params = urllib.parse.urlencode({
        "action": "parse",
        "page": "Liquipedia:Matches",
        "format": "json",
        "prop": "text",
    })
    url = f"{API_URL}?{params}"
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept-Encoding": "gzip",
    })
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            import gzip
            data = gzip.decompress(data)
        return json.loads(data)["parse"]["text"]["*"]


def parse_matches(html, days=1, team=None, competition=None, no_tbd=False):
    """Parse match data from Liquipedia HTML."""
    now = datetime.now(timezone.utc)
    cutoff = now + timedelta(days=days)

    matches = []
    blocks = html.split('class="match-info"')

    for block in blocks[1:]:
        block = block[:3000]

        ts_match = re.search(r'data-timestamp="(\d+)"', block)
        if not ts_match:
            continue
        dt = datetime.fromtimestamp(int(ts_match.group(1)), tz=timezone.utc)

        if dt < now - timedelta(hours=2) or dt > cutoff:
            continue

        # Extract team names
        team_names = re.findall(
            r'class="block-team[^"]*"[^>]*>.*?<a[^>]*title="([^"]+)"',
            block, re.DOTALL
        )
        if len(team_names) < 2:
            team_names = re.findall(
                r'class="name"[^>]*>.*?title="([^"]+)"',
                block, re.DOTALL
            )
        if len(team_names) < 2:
            team_names = ["TBD", "TBD"]

        team1 = team_names[0].strip()
        team2 = team_names[1].strip() if len(team_names) > 1 else "TBD"

        if no_tbd and ("TBD" in team1.upper() or "TBD" in team2.upper()):
            continue

        # Format (Bo1, Bo3, etc.)
        fmt_match = re.search(r'\(Bo(\d)\)', block)
        bo = f"Bo{fmt_match.group(1)}" if fmt_match else ""

        # Tournament name
        tourn_match = re.search(
            r'match-info-tournament.*?title="([^"]+)"',
            block, re.DOTALL
        )
        tournament = ""
        if tourn_match:
            raw = tourn_match.group(1)
            raw = raw.split("#")[0]
            raw = raw.replace("_", " ").replace("/", " - ")
            tournament = raw

        # Apply filters
        match_text = f"{team1} {team2} {tournament}"
        if team and not re.search(team, match_text, re.IGNORECASE):
            continue
        if competition and not re.search(competition, tournament, re.IGNORECASE):
            continue

        matches.append({
            "dt": dt,
            "team1": team1,
            "team2": team2,
            "bo": bo,
            "tournament": tournament,
        })

    matches.sort(key=lambda m: m["dt"])
    return matches


def main():
    parser = argparse.ArgumentParser(description="Fetch upcoming CS2 matches")
    parser.add_argument("days", nargs="?", type=int, default=1,
                        help="Number of days to look ahead (default: 1)")
    parser.add_argument("--team", "-t", help="Filter by team name (regex)")
    parser.add_argument("--competition", "-c", help="Filter by competition (regex)")
    parser.add_argument("--no-tbd", action="store_true",
                        help="Hide matches with TBD/unannounced teams")
    args = parser.parse_args()

    html = fetch_matches_html()
    matches = parse_matches(
        html,
        days=args.days,
        team=args.team,
        competition=args.competition,
        no_tbd=args.no_tbd,
    )

    if not matches:
        print(f"No upcoming CS2 matches in the next {args.days} day(s).")
    else:
        for m in matches:
            t = m["dt"].strftime("%a %d %b %H:%M UTC")
            bo = f" ({m['bo']})" if m["bo"] else ""
            tourn = f" | {m['tournament']}" if m["tournament"] else ""
            print(f"{t} | {m['team1']} vs {m['team2']}{bo}{tourn}")


if __name__ == "__main__":
    main()
