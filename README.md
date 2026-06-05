# Links Bot

A production-ready Telegram links bot built with Node.js, TypeScript, grammY, MongoDB Atlas, and Express. Users run `/start` to get paginated links. Owner and Sudo admins manage links, users, cache, stats, and broadcasts from Telegram.

## Features

- Fast webhook mode for production and polling mode for local development.
- MongoDB Atlas storage with the official `mongodb` driver.
- In-memory rendered page cache with invalidation on add/remove.
- Public pagination where each page unlocks as soon as it has at least one active link.
- User tracking for people who interact with the bot.
- Owner + Sudo admin system.
- Broadcast text or replied Telegram messages like photo, video, sticker, document, animation, audio, and voice.
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

## Permissions

- Owner IDs come from `OWNER_IDS` env.
- Owners have full power and cannot be removed from MongoDB.
- Sudo admins are stored in MongoDB `sudo_users`.
- Sudo admins can manage links, preview pages, view stats, reload cache, and broadcast.
- Sudo admins cannot add/remove/list sudo admins.
- Normal users can use `/start` and public pagination only.

## Sudo/Admin System

Owner-only commands:

- `/addsudo <user_id ya @username>` - sudo admin add karo.
- `/rmsudo <user_id ya @username>` - sudo admin remove karo.
- `/listsudo` - active sudo admins dekho.

Examples:

```text
/addsudo 123456789
/addsudo @someusername
/rmsudo 123456789
/listsudo
```

Telegram limitation: bot kisi bhi random `@username` ko user ID me convert nahi kar sakta. `@username` se sudo add tabhi hoga jab user pehle bot me `/start` ya interact kar chuka ho. Numeric user ID best option hai.

## Admin Commands

- `/help` - Hinglish admin guide.
- `/addlink <url>` - ek link add karo.
- `/addlinks <many urls>` - multiple links add karo.
- Reply with `/addlinks` to a message containing many URLs.
- `/removelink <page> <number>` - page position se ek active link soft-delete karo.
- `/removepage <page>` - us page ke active links soft-delete karo.
- `/listpages` - active, removed, total page, aur last-page counts dekho.
- `/preview <page>` - kisi bhi active page ka preview dekho.
- `/stats` - MongoDB, page, user, cache, uptime, memory, aur bot mode status.
- `/reloadcache` - rendered page cache clear karo.
- `/broadcaststatus` - current ya last broadcast progress dekho.

Normal users jo admin commands try karte hain unko permission error milega.

## Broadcast

Text broadcast:

```text
/broadcast Hello sabko
```

Reply broadcast:

```text
/broadcast
```

Kisi text/photo/video/sticker/document/animation/audio/voice message par reply karke `/broadcast` bhejo. Bot `copyMessage` use karta hai, isliye media download/reupload nahi hota aur caption/media preserve rehta hai jab Telegram support karta hai.

Typo aliases bhi supported hain:

```text
/broardcast
/broardacast
```

Broadcast tracked, unblocked, non-bot users ko jayega. Tracked users wahi hain jinhone bot start/interact kiya hai.

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

## Rate-Limit Safety

The bot is designed to minimize Telegram `429` errors:

- Callback queries are answered quickly.
- Pagination uses `editMessageText` instead of sending new messages.
- Bulk add sends one summary reply, not one reply per link.
- Broadcast sends slowly and only reports start/final summaries to the admin.
- If Telegram reports bot blocked, chat missing, or user deactivated, that user is marked blocked automatically.
- API calls use grammY auto-retry and throttling.

Practical Telegram limits: avoid more than 1 message per second to the same chat, avoid group spam, and keep broad sends under about 30 messages per second.

## Storage and Migration

Data is stored in MongoDB Atlas, not on the Heroku filesystem. If hosting is moved to another Heroku account, use the same `MONGODB_URI` and the existing bot data remains available.

## Security

Keep `BOT_TOKEN` and `MONGODB_URI` secret. Do not commit `.env`. Owner access is controlled by `OWNER_IDS`; sudo access is controlled by MongoDB `sudo_users`.
