# Discord interactions worker (Cloudflare)

This Worker handles **Discord button interactions** for Reddit Modmail to Discord. Reddit Devvit cannot receive public inbound webhooks from Discord, so Claim, Close, Reassign, and related ticket actions run here.

The Reddit app sends alert embeds and syncs configuration (closed-ticket webhooks, ticket registration). Button clicks update ticket state, move closed tickets, and record metrics for daily reports.

**Repository:** [github.com/MissSicariaTest/Spectrum-Modmail-Bot](https://github.com/MissSicariaTest/Spectrum-Modmail-Bot)

## Prerequisites

Before deploying, create:

1. A **Discord application** with a bot token
2. **Interactions Endpoint URL** pointing at this Worker (after first deploy)
3. Two **Cloudflare KV namespaces**

See the [main README](../README.md#advanced-setup-discord-ticket-management) for Discord bot creation and Reddit app settings.

## Deploy with Cloudflare Git integration

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Connect to Git**.
2. Select your fork of **MissSicariaTest/Spectrum-Modmail-Bot** (or this repo if you own it).
3. Set **Root directory** to: `cloudflare/discord-interactions`

### Build settings

Cloudflare may run `npm ci` automatically. If build fails with a missing lockfile error, add a build variable:

| Variable | Value |
| --- | --- |
| `SKIP_DEPENDENCY_INSTALL` | `true` |

**Build command:**

```bash
npm install && npx wrangler deploy
```

Leave **Deploy command** empty if Cloudflare would deploy twice. Use **Clear build cache** before redeploying after config changes.

### KV namespaces

**Workers & Pages → KV** → create:

| Name | Binding in `wrangler.toml` |
| --- | --- |
| `spectrum-modmail-tickets` (or any name) | `TICKETS` |
| `spectrum-modmail-report` (or any name) | `REPORT` |

Paste both namespace IDs into `wrangler.toml`, then deploy.

### Required secrets

**Settings → Variables** (encrypted secrets):

| Secret | Source |
| --- | --- |
| `DISCORD_PUBLIC_KEY` | Discord Developer Portal → General Information → **Public Key** |
| `DISCORD_BOT_TOKEN` | Developer Portal → Bot → **Token** (same bot as Reddit app settings) |
| `WORKER_SECRET` | Long random string — **must match** Reddit **Cloudflare Worker shared secret** |

Optional fallbacks if Reddit has not synced closed-ticket webhooks yet:

| Secret | Purpose |
| --- | --- |
| `CLOSED_TICKETS_WEBHOOK_SPECTRUM` | Full Discord webhook URL for Webhook 7 |
| `CLOSED_TICKETS_WEBHOOK_SPECTRUM_OFFICIAL` | Full Discord webhook URL for Webhook 8 |

After deploy, copy the Worker URL (for example `https://modmail.your-name.workers.dev`).

## Discord Developer Portal

1. **Interactions Endpoint URL:** your Worker URL (example: `https://modmail.your-name.workers.dev`)
2. **Public Key:** copy into Cloudflare `DISCORD_PUBLIC_KEY` and Reddit **Discord Application Public Key**
3. Save — Discord verifies the endpoint automatically

## Reddit app settings (must match Worker)

| Reddit setting | Worker / Discord |
| --- | --- |
| Discord Bot Token | `DISCORD_BOT_TOKEN` |
| Discord Application Public Key | `DISCORD_PUBLIC_KEY` |
| Cloudflare Worker URL | Deployed Worker URL |
| Cloudflare Worker shared secret | `WORKER_SECRET` |
| Discord Webhook 7 / 8 | Synced to Worker on new alerts (or use Cloudflare fallback secrets) |

Button actions run in Discord via this Worker. Reddit sends initial alerts and thread follow-ups.

## Health check

```bash
curl https://YOUR-WORKER.workers.dev/api/health
```

- `closedWebhooksFromReddit.spectrum: true` — Webhook 7 reached the Worker from Reddit
- `CLOSED_TICKETS_WEBHOOK_*: false` — optional Cloudflare fallback secret not set (normal if Reddit sync works)

## Report metrics API (authenticated)

```bash
curl -H "Authorization: Bearer YOUR_WORKER_SECRET" \
  https://YOUR-WORKER.workers.dev/api/report/snapshot
```

Used by the Reddit app when building daily reports. Resets after each daily report send.

## Manual deploy (CLI)

```bash
cd cloudflare/discord-interactions
npm install
npx wrangler kv namespace create TICKETS
npx wrangler kv namespace create REPORT
# Paste IDs into wrangler.toml
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put WORKER_SECRET
npm run deploy
```

## Troubleshooting

**Buttons missing on alerts** — Add Discord Bot Token in Reddit settings and `DISCORD_BOT_TOKEN` on the Worker so alerts send through the bot.

**Close does not move to Webhook 7** — Set Worker URL + shared secret in Reddit, save, then send a **new** alert. Or set `CLOSED_TICKETS_WEBHOOK_SPECTRUM` on Cloudflare.

**Invalid signature on button click** — `DISCORD_PUBLIC_KEY` must match the Discord application tied to your Interactions Endpoint URL.
