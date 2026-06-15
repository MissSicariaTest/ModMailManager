# Discord interactions worker (Cloudflare)

This folder is deployed **separately** from the Devvit Reddit app. Discord sends button clicks here because Reddit Devvit cannot receive public inbound webhooks.

## Connect Cloudflare to your GitHub fork

Use **your fork**, not the upstream repo you originally forked from:

- Repository: **`MissSicariaTest/Spectrum-Modmail-Bot`**
- Branch: **`cursor/discord-interactive-buttons-bf46`** (or `main` after merge)

### If build fails with `npm ci` / missing `package-lock.json`

Cloudflare runs automatic `npm ci` before your build command. Add a **build variable**:

| Variable | Value |
|----------|--------|
| `SKIP_DEPENDENCY_INSTALL` | `true` |

Then set **Build command** to:

```bash
npm install && npx wrangler deploy
```

Leave **Deploy command** empty, or set it to `true` / remove duplicate deploy if Cloudflare requires a value — use only one deploy step.

Also click **Clear build cache** under Build settings, then create a **new** deployment (not retry an old one).


1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create**
2. Choose **Connect to Git** (you already signed in with GitHub)
3. Select **`MissSicariaTest/Spectrum-Modmail-Bot`**
4. Set **Root directory** to: `cloudflare/discord-interactions`
5. **Build command:** `npm install && npx wrangler deploy`
6. Create before first deploy:
   - **Workers & Pages → KV** → Create namespace **`spectrum-modmail-tickets`**
   - Create namespace **`spectrum-modmail-report`**
   - Copy both namespace IDs into `wrangler.toml` (replace `REPLACE_WITH_*`)
7. **Settings → Variables** (secrets):
   - `DISCORD_PUBLIC_KEY` — from Discord Developer Portal → General Information → Public Key
   - `WORKER_SECRET` — generate a long random string (same value goes in Reddit app settings)
8. Deploy. Copy the worker URL, e.g. `https://spectrum-modmail-discord.your-subdomain.workers.dev`

### Discord Developer Portal

1. Create a **Discord Application** (or use your existing mod bot app).
2. **General Information → Interactions Endpoint URL:** paste your worker URL  
   Example: `https://modmail.your-subdomain.workers.dev`
3. Copy **Public Key** into Cloudflare `DISCORD_PUBLIC_KEY` and Reddit app settings.
4. Save. Discord sends a ping; the worker responds automatically.

### Application-owned webhooks (required for buttons)

Channel webhooks created in Discord channel settings send alerts but **strip interactive buttons**.

For Claim / Close / Reassign buttons:

1. Use the same Discord application as your Interactions Endpoint.
2. Create webhooks through that application (bot-owned webhooks), not channel Integrations → Webhooks.
3. Paste those URLs into Discord Webhook 1–6 in Reddit app settings.

If buttons are missing on alerts, the notification still works but ticket actions will not.

### Reddit Devvit app settings (subreddit install page)

| Setting | Value |
|---------|--------|
| `discordApplicationPublicKey` | Discord Public Key (optional backup; worker uses its own secret) |
| `discordInteractionsWorkerUrl` | Worker URL (no trailing slash) |
| `discordInteractionsWorkerSecret` | Same string as Cloudflare `WORKER_SECRET` |

Request **`workers.dev`** in Devvit developer settings if ticket registration from Reddit fails with `PERMISSION_DENIED`.

## Manual deploy (without GitHub)

```bash
cd cloudflare/discord-interactions
npm install
npx wrangler kv namespace create TICKETS
npx wrangler kv namespace create REPORT
# Paste IDs into wrangler.toml
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put WORKER_SECRET
npm run deploy
```
