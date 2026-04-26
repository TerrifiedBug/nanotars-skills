# Nanotars Skills Marketplace

Claude Code plugin marketplace for [Nanotars](https://github.com/TerrifiedBug/nanotars) integrations.

## Quick Start

```
/plugin marketplace add TerrifiedBug/nanotars-skills
/plugin install nanotars-weather@nanotars-skills
```

Or browse all skills: run `/plugin` and go to the **Discover** tab.

## Available Skills (28)

### Messaging Channels

| Plugin | Description |
|--------|-------------|
| `nanotars-discord` | Discord bot channel plugin |
| `nanotars-slack` | Slack channel via Socket Mode (no public URL needed; bundles mrkdwn formatting guidance for agents) |
| `nanotars-telegram` | Telegram bot channel plugin |
| `nanotars-whatsapp` | WhatsApp channel via Baileys with QR auth |

### Productivity

| Plugin | Description |
|--------|-------------|
| `nanotars-calendar` | Google Calendar + CalDAV access via gog CLI and TypeScript CalDAV client |
| `nanotars-dashboard` | Admin web UI with system health, task management, message viewer, and logs |
| `nanotars-gmail` | Gmail search, read, and send via gog CLI (Google Workspace) |
| `nanotars-imap-read` | Read-only IMAP email access supporting multiple providers |
| `nanotars-notion` | Notion API for reading and updating pages, databases, and projects |

### Search & Research

| Plugin | Description |
|--------|-------------|
| `nanotars-brave-search` | Web search via Brave Search API for research and current events |
| `nanotars-parallel` | Parallel AI web research via MCP Servers for quick multi-source lookups |

### Media

| Plugin | Description |
|--------|-------------|
| `nanotars-giphy` | GIF search and sending via Giphy API |
| `nanotars-transcription` | Voice message transcription via OpenAI Whisper API |

### Monitoring & Automation

| Plugin | Description |
|--------|-------------|
| `nanotars-changedetection` | Website change monitoring via changedetection.io |
| `nanotars-cs2-esports` | CS2 esports match tracking from Liquipedia |
| `nanotars-freshrss` | Self-hosted RSS feed reader via FreshRSS API |
| `nanotars-github` | GitHub API access for PRs, issues, commits, and repo monitoring |
| `nanotars-n8n` | n8n workflow automation — create, monitor, and trigger workflows |
| `nanotars-stocks` | Stock prices and financial data via Yahoo Finance |
| `nanotars-webhook` | HTTP webhook endpoint for push events from external services |

### Smart Home

| Plugin | Description |
|--------|-------------|
| `nanotars-homeassistant` | Home Assistant control via official MCP Server |

### Utilities

| Plugin | Description |
|--------|-------------|
| `nanotars-claude-mem` | Persistent cross-session memory via claude-mem vector database |
| `nanotars-commute` | Travel times and commute lookup using Waze live traffic data |
| `nanotars-norish` | Recipe import by URL to Norish instance |
| `nanotars-telegram-swarm` | Agent Teams for Telegram — each subagent gets its own bot identity |
| `nanotars-trains` | UK National Rail departures and arrivals via Darwin API |
| `nanotars-weather` | Weather forecasts via free wttr.in and Open-Meteo APIs (no key needed) |

## Installing a Skill

```bash
# 1. Add this marketplace (one-time)
/plugin marketplace add TerrifiedBug/nanotars-skills

# 2. Install a skill
/plugin install nanotars-weather@nanotars-skills

# 3. Run the installation skill
/add-skill-weather
```

Each skill creates a plugin in your `plugins/` directory with a `plugin.json` manifest, container skills, and any required configuration.

## Contributing

Create a skill with `/create-skill-plugin` in your Nanotars repo, test it locally, then publish with `/nanotars-publish-skill`.

See [CONTRIBUTING.md](https://github.com/TerrifiedBug/nanotars/blob/main/CONTRIBUTING.md) for details.
