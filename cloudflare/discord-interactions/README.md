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
7. **Settings → Variables** (secrets — required after every new worker or Git deploy):
   - `DISCORD_PUBLIC_KEY` — from Discord Developer Portal → General Information → **Public Key**
   - `DISCORD_BOT_TOKEN` — from Discord Developer Portal → Bot → Token
   - `WORKER_SECRET` — generate a long random string (same value goes in Reddit app settings)
8. Deploy. Copy the worker URL, e.g. `https://modmail.your-subdomain.workers.dev`

Check configuration anytime: `GET https://your-worker.workers.dev/api/health`

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
| `discordBotToken` | Discord Bot Token (same app as Interactions Endpoint; also set `DISCORD_BOT_TOKEN` on Worker) |
| `discordApplicationPublicKey` | Optional backup of Discord Public Key |
| `discordInteractionsWorkerUrl` | Optional — daily report ticket metrics only |
| `discordInteractionsWorkerSecret` | Optional — must match Cloudflare `WORKER_SECRET` if used |

Button actions (Claim, Close, Reassign, etc.) run entirely in Discord via the Cloudflare worker. Reddit only sends the initial alert embed and links.

### Why buttons may be missing

Regular channel webhooks (Integrations → Webhooks in Discord) send alerts but **remove interactive buttons**.

**Fix:** Add your **Discord Bot Token** in Reddit app settings and Cloudflare `DISCORD_BOT_TOKEN`. The app sends alerts through your bot so Claim/Close/Reassign buttons appear, while still using your existing webhook URLs to find the right channel.

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
