# Slack Channel Capabilities

You are communicating via Slack.

## Sending files

You can send files to the user using `mcp__nanoclaw__send_file`. Save the file to your workspace first (under `/workspace/`), then call the tool with the absolute path.

Supported: images (jpg, png, gif, webp), videos (mp4), audio (mp3, ogg), documents (pdf, doc, txt, csv, json, zip). Maximum 64 MB.

**GIFs:** Slack displays animated GIFs natively — send GIF format directly (not MP4). When using GIF search results, prefer the `gif_url` over `mp4_url`.

Use this when:
- The user asks for generated content (charts, reports, exports, spreadsheets)
- Sharing a file is more useful than pasting text inline
- The user sends you a file and asks you to modify and return it

## Receiving media

When users share files in Slack, they appear as `[type: /workspace/group/media/filename]` in the message. The file is available at that path for you to read or process.

## Reactions

You can react to messages with emoji using `mcp__nanoclaw__react`. Use the message ID from the `id` attribute on `<message>` tags in the conversation.

Use Slack short names (not Unicode emoji): `thumbsup`, `heart`, `fire`, `eyes`, `white_check_mark`, `tada`, `thinking_face`, `rocket`, etc. Any valid Slack emoji name works, including custom workspace emoji.

Good uses: acknowledge a request (thumbsup), show you found something funny (joy), confirm you've seen something (white_check_mark). Keep it natural.

## Agent Teams

When using Agent Teams (subagents), each agent's messages appear with a distinct display name in Slack (if the workspace has `chat:write.customize` enabled). If not, the agent name appears as a bold prefix.

## Platform notes

- Messages support Slack's mrkdwn format: `*bold*`, `_italic_`, `~strikethrough~`, `` `code` ``, ` ```code block``` `
- In group channels, replies are sent as threads to keep the channel tidy
- In DMs, replies go directly in the conversation (no threading)
- Long messages are auto-split if they exceed 40,000 characters
- Use `<URL|display text>` format for hyperlinks

# Slack Message Formatting (mrkdwn)

When responding to Slack channels, use Slack's mrkdwn syntax instead of standard Markdown.

## How to detect Slack context

Check your group folder name or workspace path:
- Folder starts with `slack_` (e.g., `slack_engineering`, `slack_general`)
- Or check `/workspace/group/` path for `slack_` prefix

## Formatting reference

### Text styles

| Style | Syntax | Example |
|-------|--------|---------|
| Bold | `*text*` | *bold text* |
| Italic | `_text_` | _italic text_ |
| Strikethrough | `~text~` | ~strikethrough~ |
| Code (inline) | `` `code` `` | `inline code` |
| Code block | ` ```code``` ` | Multi-line code |

### Links and mentions

```
<https://example.com|Link text>     # Named link
<https://example.com>                # Auto-linked URL
<@U1234567890>                       # Mention user by ID
<#C1234567890>                       # Mention channel by ID
<!here>                              # @here
<!channel>                           # @channel
```

### Lists

Slack supports simple bullet lists but NOT numbered lists:

```
• First item
• Second item
• Third item
```

Use `•` (bullet character) or `- ` or `* ` for bullets.

### Block quotes

```
> This is a block quote
> It can span multiple lines
```

### Emoji

Use standard emoji shortcodes: `:white_check_mark:`, `:x:`, `:rocket:`, `:tada:`

## What NOT to use

- **NO** `##` headings (use `*Bold text*` for headers instead)
- **NO** `**double asterisks**` for bold (use `*single asterisks*`)
- **NO** `[text](url)` links (use `<url|text>` instead)
- **NO** `1.` numbered lists (use bullets with numbers: `• 1. First`)
- **NO** tables (use code blocks or plain text alignment)
- **NO** `---` horizontal rules

## Example message

```
*Daily Standup Summary*

_March 21, 2026_

• *Completed:* Fixed authentication bug in login flow
• *In Progress:* Building new dashboard widgets
• *Blocked:* Waiting on API access from DevOps

> Next sync: Monday 10am

:white_check_mark: All tests passing | <https://ci.example.com/builds/123|View Build>
```

## Quick rules

1. Use `*bold*` not `**bold**`
2. Use `<url|text>` not `[text](url)`
3. Use `•` bullets, avoid numbered lists
4. Use `:emoji:` shortcodes
5. Quote blocks with `>`
6. Skip headings — use bold text instead
