# Links Bot

A production-ready Telegram links bot built with Node.js, TypeScript, grammY, MongoDB Atlas, and Express. Users run `/start` to receive unlocked pages of links. Owners manage links through Telegram commands.

## Features

- Fast webhook mode for production and polling mode for local development.
- MongoDB Atlas storage with the official `mongodb` driver.
- In-memory rendered page cache with invalidation on add/remove.
- Public pagination where each page unlocks as soon as it has at least one active link.
- User tracking for people who interact with the bot.
- Owner-only link add, bulk add, remove, preview, stats, cache, and broadcast controls.
- Safe Telegram API behavior with auto-retry, throttling, compact messages, pagination edits, and slow broadcasts.
- Heroku-ready `Procfile`, `app.json`, and one-click deploy button.

## Deploy to Heroku

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/SkyBotsDeveloper/links-bot)

## Required Config Vars

| Var | Description |
| --- | --- |
| `BOT_TOKEN` | Telegram bot token from BotFather. |
| `MONGODB_URI` | MongoDB Atlas connection string. Include a database name or the bot uses `links_bot`. |
| `OWNER_IDS` | Comma-separated numeric Telegram user IDs. |
| `PUBLIC_URL` | Public Heroku app URL, for example `https://your-app.herokuapp.com`. |
| `NODE_ENV` | Use `production` on Heroku. |
| `LINKS_PER_PAGE` | Defaults to `50`. Pages are sliced by this size. |

## MongoDB Atlas Setup

1. Create a MongoDB Atlas cluster.
2. Create a database user with read/write access.
3. Add your Heroku outbound access rule, or temporarily allow `0.0.0.0/0` if that matches your risk policy.
4. Copy the connection string and set it as `MONGODB_URI`.
5. Optional: include `/links_bot` before the query string to choose the database name.

## BotFather Token

1. Open Telegram and message `@BotFather`.
2. Run `/newbot`.
3. Follow the prompts and copy the token.
4. Set the token as `BOT_TOKEN`. Keep it secret.

## Owner ID

To get your numeric Telegram user ID, message a trusted ID bot such as `@userinfobot`, or inspect updates from your bot while testing locally. Put one or more IDs in `OWNER_IDS`, separated by commas:

```text
OWNER_IDS=123456789,987654321
```

## Heroku Deployment

1. Click the deploy button above.
2. Set all required config vars.
3. Deploy the app.
4. Heroku runs `npm start`, which starts webhook mode.
5. The app exposes `GET /health`:

```json
{
  "ok": true,
  "service": "links-bot",
  "mode": "webhook"
}
```

Webhook updates are received at `POST /webhook/:secret`. The secret is derived internally from `BOT_TOKEN`; the token is never printed in logs.

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

If `NODE_ENV` is not `production` and `PUBLIC_URL` is missing, the bot uses polling for local testing. To test webhook mode locally, set `PUBLIC_URL` to a public tunnel URL.

Useful scripts:

```bash
npm run typecheck
npm run build
npm run seed
npm start
```

`npm run seed` inserts the included 50 starter links only when the `links` collection is empty.

## Owner Commands

- `/help` - show the owner guide.
- `/addlink <url>` - add one `http://` or `https://` link.
- `/addlinks <many urls>` - add many links from the command message.
- Reply with `/addlinks` to a message containing many URLs.
- `/removelink <page> <number>` - soft-delete one active link by page position.
- `/removepage <page>` - soft-delete up to 50 active links from that page.
- `/listpages` - show active, removed, total page, and last-page counts.
- `/preview <page>` - preview any active page.
- `/stats` - show MongoDB, page, user, cache, uptime, memory, and bot mode status.
- `/reloadcache` - clear rendered page cache.
- `/broadcast <message>` - send a text message to all tracked, unblocked, non-bot users.
- Reply with `/broadcast` to broadcast the replied message text or caption.
- `/broadcaststatus` - show current or last broadcast progress for this process.

Normal users who try owner commands receive `❌ Not allowed.`

## Pagination Rule

`LINKS_PER_PAGE` defaults to 50.

- 0 active links: `/start` shows the preparing message.
- 1 to 50 active links: page 1 unlocks.
- 51 active links: page 2 unlocks with 1 link.
- 75 active links: page 2 unlocks with 25 links.
- 100 active links: page 2 has 50 links.
- 101 active links: page 3 unlocks with 1 link.

Numbering restarts from 1 on every page, even when a later page has fewer than 50 links.

## User Tracking

The bot tracks users who interact with it, including `/start`, messages, and callbacks. Telegram does not provide a full list of silent users who have opened the bot but never sent anything, so `/stats` reports tracked users, meaning users who interacted with the bot.

Tracked fields include Telegram user ID, name fields, username, language code, bot flag, first and last seen timestamps, start count, message count, blocked status, and last broadcast timestamp.

## Broadcasts

Owners can run:

```text
/broadcast Hello everyone
```

Or reply to a text/caption message with:

```text
/broadcast
```

The bot broadcasts only to tracked users where `isBlocked=false` and `isBot=false`. Broadcasts are sent gradually, not all at once. If Telegram reports that the bot was blocked, the chat is missing, or the user is deactivated, the user is marked blocked automatically.

## Rate-Limit Safety

The bot is designed to minimize Telegram `429` errors:

- Callback queries are answered quickly.
- Pagination uses `editMessageText` instead of sending new messages.
- Bulk add sends one summary reply, not one reply per link.
- Broadcast sends slowly and only reports start/final summaries to the owner.
- API calls use grammY auto-retry and throttling.

Practical Telegram limits: avoid more than 1 message per second to the same chat, avoid group spam, and keep broad sends under about 30 messages per second.

## Storage and Migration

Data is stored in MongoDB Atlas, not on the Heroku filesystem. If hosting is moved to another Heroku account, use the same `MONGODB_URI` and the existing bot data remains available.

## Security

Keep `BOT_TOKEN` and `MONGODB_URI` secret. Do not commit `.env`. Owner access is controlled only by `OWNER_IDS` from the environment.
