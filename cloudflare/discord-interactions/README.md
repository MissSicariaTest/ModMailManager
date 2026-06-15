# ModMailManager — Discord Interactions Worker (Cloudflare)

This Cloudflare Worker handles **Discord button interactions** for ModMailManager. When a moderator clicks a ticket button (Claim, Close, Resolved, etc.) in Discord, Discord sends the interaction here. The Worker updates the ticket state, edits the embed in-place, and moves closed tickets to the archive channel.

Reddit Devvit cannot receive public inbound webhooks from Discord, so all button click handling runs in this Worker rather than the Reddit app.

**Repository:** [github.com/MissSicariaTest/ModMailManager](https://github.com/MissSicariaTest/ModMailManager)

---

## Prerequisites

Before deploying, you need:

1. A Discord application with a bot token (see [main README](../../README.md#create-a-discord-bot))
2. Two Cloudflare KV namespaces created in your Cloudflare dashboard
3. A shared secret string you will use in both Cloudflare and Reddit app settings

---

## Deploy via Cloudflare Git Integration

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Connect to Git**
2. Select the **MissSicariaTest/ModMailManager** repository (or your fork)
3. Set **Root directory** to: `cloudflare/discord-interactions`

### Build settings

Cloudflare may try to run `npm ci` before your build step. If the build fails with a missing lockfile error, add a build variable:

| Variable | Value |
| --- | --- |
| `SKIP_DEPENDENCY_INSTALL` | `true` |

**Build command:**

```bash
npm install && npx wrangler deploy
```

Leave the Deploy command empty (the build command deploys the Worker). Use **Clear build cache** after changing KV namespace IDs or secrets.

### KV namespaces

Create two namespaces in **Cloudflare Dashboard → Workers & Pages → KV**:

| Create with name | Binding in wrangler.toml |
| --- | --- |
| `modmail-tickets` (or any name) | `TICKETS` |
| `modmail-report` (or any name) | `REPORT` |

After creating, copy each namespace ID and paste it into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "TICKETS"
id = "PASTE_TICKETS_NAMESPACE_ID_HERE"

[[kv_namespaces]]
binding = "REPORT"
id = "PASTE_REPORT_NAMESPACE_ID_HERE"
```

### Required secrets

In **Settings → Variables** (use encrypted secrets, not plain variables):

| Secret | Where to get it |
| --- | --- |
| `DISCORD_PUBLIC_KEY` | Discord Developer Portal → your app → **General Information → Public Key** |
| `DISCORD_BOT_TOKEN` | Discord Developer Portal → **Bot → Token** (same bot invited to your server) |
| `WORKER_SECRET` | A long random string — **must match** the **Cloudflare Worker Shared Secret** in Reddit app settings |

Optional closed-ticket webhook fallbacks (used if Reddit has not synced Webhook 7 yet):

| Secret | Purpose |
| --- | --- |
| `CLOSED_TICKETS_WEBHOOK_PRIMARY` | Full Discord webhook URL for the primary closed-tickets channel |
| `CLOSED_TICKETS_WEBHOOK_SECONDARY` | Full Discord webhook URL for the secondary closed-tickets channel |

After deploying, copy your Worker URL (for example `https://modmail.your-name.workers.dev`).

---

## Discord Developer Portal

1. Open your Discord application → **General Information**
2. Set **Interactions Endpoint URL** to your Worker URL
3. Copy the **Public Key** → add it as `DISCORD_PUBLIC_KEY` on the Worker and as **Discord Application Public Key** in Reddit app settings
4. Click **Save** — Discord sends a ping to verify; the Worker responds automatically

---

## Reddit App Settings

Go to `https://developers.reddit.com/r/YOUR-SUBREDDIT/apps/modmailmanager` and fill in:

| Setting | Value |
| --- | --- |
| Discord Bot Token | Your bot token |
| Discord Application Public Key | Public Key from Developer Portal |
| Cloudflare Worker URL | Your deployed Worker URL (no trailing slash) |
| Cloudflare Worker Shared Secret | Same value as `WORKER_SECRET` on the Worker |
| Webhook 7 — Closed Tickets (Primary) | Webhook URL for the closed-tickets archive channel |

Save, then trigger a new alert (send a modmail to your subreddit) so the app syncs Webhook 7 to the Worker.

---

## Health check

```bash
curl https://YOUR-WORKER.workers.dev/api/health
```

Expected response fields:

- `ok: true` — secrets are configured
- `closedWebhooksFromReddit.primary: true` — Webhook 7 has been synced from Reddit settings
- `CLOSED_TICKETS_WEBHOOK_*: false` — optional Cloudflare fallback secrets not set (normal if Reddit sync works)

---

## Authenticated report metrics API

The Reddit app calls this endpoint when building daily reports:

```bash
curl -H "Authorization: Bearer YOUR_WORKER_SECRET" \
  https://YOUR-WORKER.workers.dev/api/report/snapshot
```

Returns button-action counts per moderator. Resets after each daily report send.

---

## Manual deploy (CLI)

```bash
cd cloudflare/discord-interactions
npm install
npx wrangler kv namespace create TICKETS
npx wrangler kv namespace create REPORT
# Paste both namespace IDs into wrangler.toml
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put WORKER_SECRET
npm run deploy
```

---

## Troubleshooting

**Buttons are missing on alerts** — Add the Discord Bot Token in Reddit app settings and `DISCORD_BOT_TOKEN` on the Worker. Standard channel webhooks (Integrations → Webhooks in Discord) may strip interactive components. Your bot must be in the server and able to send messages in the alert channel.

**Close button does not move the ticket to Webhook 7** — Ensure Worker URL + Shared Secret are set in Reddit app settings. Save, then trigger a new alert so the app syncs the closed-tickets webhook URL to the Worker. Alternatively, set `CLOSED_TICKETS_WEBHOOK_PRIMARY` directly on the Worker as a fallback.

**Invalid request signature on button click** — `DISCORD_PUBLIC_KEY` must match the application in Discord's Developer Portal that is set as the Interactions Endpoint. If you have multiple apps, confirm you are using the correct one.

**Worker build fails on Cloudflare** — Add `SKIP_DEPENDENCY_INSTALL=true` as a build variable and set build command to `npm install && npx wrangler deploy`. Clear the build cache before retrying.
