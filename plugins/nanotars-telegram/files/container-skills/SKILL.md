# Telegram Channel Capabilities

You are communicating via Telegram.

## Sending files

`send_file` is supported. Images (`.png/.jpg/.jpeg/.gif/.webp`), videos (`.mp4/.mov/.webm/.mkv`), and audio (`.mp3/.m4a/.ogg/.wav/.opus`) render inline with previews. Other file types are delivered as downloadable documents. Captions are clipped to 1024 characters (Telegram's hard limit).

## Receiving media

Media attachments from users are not currently downloaded. If a user sends an image or file, you will not be able to see or process its contents.

## Platform notes

- Messages support Telegram's HTML formatting (bold, italic, code blocks)
- Long messages are automatically split into chunks
- When running as a team, each subagent may appear as a separate bot identity in the group
