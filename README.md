# NanoClaw Skills Marketplace

Claude Code plugin marketplace for [NanoClaw](https://github.com/TerrifiedBug/nanoclaw) integrations.

## Quick Start

```
/plugin marketplace add TerrifiedBug/nanoclaw-skills
/plugin install nanoclaw-weather@nanoclaw-skills
```

Or browse all skills: run `/plugin` and go to the **Discover** tab.

## Available Skills (27)

### Messaging Channels

| Plugin | Description |
|--------|-------------|
| `nanoclaw-discord` | Discord bot channel plugin |
| `nanoclaw-slack` | Slack channel via Socket Mode (no public URL needed) |
| `nanoclaw-telegram` | Telegram bot channel plugin |
| `nanoclaw-whatsapp` | WhatsApp channel via Baileys with QR auth |

### Productivity

| Plugin | Description |
|--------|-------------|
| `nanoclaw-calendar` | Google Calendar + CalDAV access via gog CLI and TypeScript CalDAV client |
| `nanoclaw-dashboard` | Admin web UI with system health, task management, message viewer, and logs |
| `nanoclaw-gmail` | Gmail search, read, and send via gog CLI (Google Workspace) |
| `nanoclaw-imap-read` | Read-only IMAP email access supporting multiple providers |
| `nanoclaw-notion` | Notion API for reading and updating pages, databases, and projects |

### Search & Research

| Plugin | Description |
|--------|-------------|
| `nanoclaw-brave-search` | Web search via Brave Search API for research and current events |
| `nanoclaw-parallel` | Parallel AI web research via MCP Servers for quick multi-source lookups |

### Media

| Plugin | Description |
|--------|-------------|
| `nanoclaw-giphy` | GIF search and sending via Giphy API |
| `nanoclaw-transcription` | Voice message transcription via OpenAI Whisper API |

### Monitoring & Automation

| Plugin | Description |
|--------|-------------|
| `nanoclaw-changedetection` | Website change monitoring via changedetection.io |
| `nanoclaw-cs2-esports` | CS2 esports match tracking from Liquipedia |
| `nanoclaw-freshrss` | Self-hosted RSS feed reader via FreshRSS API |
| `nanoclaw-github` | GitHub API access for PRs, issues, commits, and repo monitoring |
| `nanoclaw-n8n` | n8n workflow automation — create, monitor, and trigger workflows |
| `nanoclaw-stocks` | Stock prices and financial data via Yahoo Finance |
| `nanoclaw-webhook` | HTTP webhook endpoint for push events from external services |

### Smart Home

| Plugin | Description |
|--------|-------------|
| `nanoclaw-homeassistant` | Home Assistant control via official MCP Server |

### Utilities

| Plugin | Description |
|--------|-------------|
| `nanoclaw-claude-mem` | Persistent cross-session memory via claude-mem vector database |
| `nanoclaw-commute` | Travel times and commute lookup using Waze live traffic data |
| `nanoclaw-norish` | Recipe import by URL to Norish instance |
| `nanoclaw-telegram-swarm` | Agent Teams for Telegram — each subagent gets its own bot identity |
| `nanoclaw-trains` | UK National Rail departures and arrivals via Darwin API |
| `nanoclaw-weather` | Weather forecasts via free wttr.in and Open-Meteo APIs (no key needed) |

## Installing a Skill

```bash
# 1. Add this marketplace (one-time)
/plugin marketplace add TerrifiedBug/nanoclaw-skills

# 2. Install a skill
/plugin install nanoclaw-weather@nanoclaw-skills

# 3. Run the installation skill
/add-skill-weather
```

Each skill creates a plugin in your `plugins/` directory with a `plugin.json` manifest, container skills, and any required configuration.

## Contributing

Create a skill with `/create-skill-plugin` in your NanoClaw repo, test it locally, then publish with `/nanoclaw-publish-skill`.

See [CONTRIBUTING.md](https://github.com/TerrifiedBug/nanoclaw/blob/main/CONTRIBUTING.md) for details.
