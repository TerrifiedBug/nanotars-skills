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

| Plugin | Description | Install |
|--------|-------------|---------|
| nanoclaw-discord | Add Discord as a channel. Runs alongside WhatsApp or other channels. | `/plugin install nanoclaw-discord@nanoclaw-skills` |
| nanoclaw-slack | Add Slack as a messaging channel. Uses Socket Mode (no public URL needed). Trigg | `/plugin install nanoclaw-slack@nanoclaw-skills` |
| nanoclaw-telegram | Add Telegram as a channel. Can replace WhatsApp entirely or run alongside it. Al | `/plugin install nanoclaw-telegram@nanoclaw-skills` |
| nanoclaw-whatsapp | Add WhatsApp as a channel. Install the WhatsApp channel plugin and authenticate. | `/plugin install nanoclaw-whatsapp@nanoclaw-skills` |

### Productivity

| Plugin | Description | Install |
|--------|-------------|---------|
| nanoclaw-calendar | Add calendar access to NanoClaw. Supports Google Calendar (gog CLI with OAuth) a | `/plugin install nanoclaw-calendar@nanoclaw-skills` |
| nanoclaw-dashboard | Add admin dashboard with system monitoring and task management. Triggers on "add | `/plugin install nanoclaw-dashboard@nanoclaw-skills` |
| nanoclaw-gmail | Add Gmail access to NanoClaw via gog CLI (Google Workspace CLI). Agents can sear | `/plugin install nanoclaw-gmail@nanoclaw-skills` |
| nanoclaw-imap-read | Add read-only IMAP email access to NanoClaw agent containers. Supports multiple  | `/plugin install nanoclaw-imap-read@nanoclaw-skills` |
| nanoclaw-notion | Add Notion API access to NanoClaw. Enables agents to read and update Notion page | `/plugin install nanoclaw-notion@nanoclaw-skills` |

### Search & Research

| Plugin | Description | Install |
|--------|-------------|---------|
| nanoclaw-brave-search | Add Brave Search API access to NanoClaw agent containers. Enables web search for | `/plugin install nanoclaw-brave-search@nanoclaw-skills` |
| nanoclaw-parallel | Add Parallel AI web research to NanoClaw via MCP Servers. Enables quick web sear | `/plugin install nanoclaw-parallel@nanoclaw-skills` |

### Media

| Plugin | Description | Install |
|--------|-------------|---------|
| nanoclaw-giphy | Add GIF search and sending to NanoClaw agents via Giphy API. Enables humorous GI | `/plugin install nanoclaw-giphy@nanoclaw-skills` |
| nanoclaw-transcription | Add voice message transcription to NanoClaw using OpenAI's Whisper API. Automati | `/plugin install nanoclaw-transcription@nanoclaw-skills` |

### Monitoring & Automation

| Plugin | Description | Install |
|--------|-------------|---------|
| nanoclaw-changedetection | Add changedetection.io integration to NanoClaw. Enables agents to create and man | `/plugin install nanoclaw-changedetection@nanoclaw-skills` |
| nanoclaw-cs2-esports | Add CS2 esports match tracking to NanoClaw. Shows upcoming Counter-Strike 2 matc | `/plugin install nanoclaw-cs2-esports@nanoclaw-skills` |
| nanoclaw-freshrss | Add FreshRSS feed reader integration to NanoClaw. Connects agents to a self-host | `/plugin install nanoclaw-freshrss@nanoclaw-skills` |
| nanoclaw-github | Add GitHub API access to NanoClaw. Enables agents to monitor repos, check PRs, i | `/plugin install nanoclaw-github@nanoclaw-skills` |
| nanoclaw-n8n | Add n8n workflow automation integration to NanoClaw. Enables agents to create mo | `/plugin install nanoclaw-n8n@nanoclaw-skills` |
| nanoclaw-stocks | Add stock price and financial data lookups via Yahoo Finance. Triggers on stock  | `/plugin install nanoclaw-stocks@nanoclaw-skills` |
| nanoclaw-webhook | Add a webhook HTTP endpoint so external services (Home Assistant, uptime monitor | `/plugin install nanoclaw-webhook@nanoclaw-skills` |

### Smart Home

| Plugin | Description | Install |
|--------|-------------|---------|
| nanoclaw-homeassistant | Add Home Assistant integration to NanoClaw via official MCP Server. Enables agen | `/plugin install nanoclaw-homeassistant@nanoclaw-skills` |

### Utilities

| Plugin | Description | Install |
|--------|-------------|---------|
| nanoclaw-claude-mem | Add persistent memory (claude-mem) to NanoClaw agent containers. Creates systemd | `/plugin install nanoclaw-claude-mem@nanoclaw-skills` |
| nanoclaw-commute | Add travel time and commute lookup to NanoClaw agents using Waze live traffic da | `/plugin install nanoclaw-commute@nanoclaw-skills` |
| nanoclaw-norish | Add Norish recipe import to NanoClaw agents. Send recipe URLs to your Norish ins | `/plugin install nanoclaw-norish@nanoclaw-skills` |
| nanoclaw-telegram-swarm | Add Agent Swarm (Teams) support to Telegram. Each subagent gets its own bot iden | `/plugin install nanoclaw-telegram-swarm@nanoclaw-skills` |
| nanoclaw-trains | Add UK train departure/arrival information to NanoClaw via National Rail Darwin  | `/plugin install nanoclaw-trains@nanoclaw-skills` |
| nanoclaw-weather | Add weather lookup capability to NanoClaw agents. Uses free wttr.in and Open-Met | `/plugin install nanoclaw-weather@nanoclaw-skills` |

## Contributing

Create a skill with `/create-skill-plugin` in your NanoClaw repo, test it locally, then publish with `/nanoclaw-publish-skill`.
