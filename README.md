# Links Bot

A production-ready Telegram links bot built with Node.js, TypeScript, grammY, MongoDB Atlas, and Express. Users run `/start` to receive unlocked pages of links. Owners manage links through Telegram commands.

## Features

- Fast webhook mode for production and polling mode for local development.
- MongoDB Atlas storage with the official `mongodb` driver.
- In-memory rendered page cache with invalidation on add/remove.
- Public pagination with locked incomplete pages.
- Owner-only link add, bulk add, remove, preview, stats, and cache controls.
- Safe Telegram API behavior with auto-retry, throttling, compact messages, and pagination edits.
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
| `LINKS_PER_PAGE` | Defaults to `50`. A public page unlocks only when it has exactly this many links. |

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
- `/listpages` - show active, removed, unlocked, and pending counts.
- `/preview <page>` - preview any active page, including incomplete locked pages.
- `/stats` - show MongoDB, cache, uptime, and memory status.
- `/reloadcache` - clear rendered page cache.

Normal users who try owner commands receive `❌ Not allowed.`

## Pagination Lock Rule

`LINKS_PER_PAGE` defaults to 50.

- 1 to 49 active links: no public page is unlocked.
- 50 active links: page 1 unlocks.
- 51 to 99 active links: page 1 unlocks and page 2 is visible but locked.
- 100 active links: page 2 unlocks.
- The same pattern continues forever.

Public users never see incomplete pages. Owners can preview incomplete pages with `/preview <page>`.

## Rate-Limit Safety

The bot is designed to minimize Telegram `429` errors:

- Callback queries are answered quickly.
- Pagination uses `editMessageText` instead of sending new messages.
- Locked page clicks show only an alert.
- Bulk add sends one summary reply, not one reply per link.
- There is no automatic broadcast feature.
- API calls use grammY auto-retry and throttling.

Practical Telegram limits: avoid more than 1 message per second to the same chat, avoid group spam, and keep broad sends under about 30 messages per second.

## Storage and Migration

Data is stored in MongoDB Atlas, not on the Heroku filesystem. If hosting is moved to another Heroku account, use the same `MONGODB_URI` and the existing bot data remains available.

## Security

Keep `BOT_TOKEN` and `MONGODB_URI` secret. Do not commit `.env`. Owner access is controlled only by `OWNER_IDS` from the environment.
