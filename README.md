# Reddit Modmail to Discord

**Reddit Modmail to Discord** is an application that sends incoming modmail messages, new posts, and mod queue alerts from your subreddit to your Discord channels. It sends the message and other relevant information through a webhook payload so your team can be notified when new messages, posts, or moderation items need attention.

**App:** [developers.reddit.com/apps/modmailmanager](https://developers.reddit.com/apps/modmailmanager)  
**Source:** [github.com/MissSicariaTest/Spectrum-Modmail-Bot](https://github.com/MissSicariaTest/Spectrum-Modmail-Bot)

## What it does

- Sends **modmail** alerts to Discord (incoming messages, optional outgoing mod replies, private mod notes)
- Sends **new post** alerts when posts are submitted to your subreddit
- Sends **mod queue** alerts for reported posts/comments and AutoMod filtered items
- Optional **thread follow-ups** in Discord when users or mods reply on linked Reddit posts
- Optional **daily moderation reports** to a dedicated reporting channel
- Optional **interactive ticket buttons** in Discord (Claim, Close, Resolved, Unresolved, Reassign, Reopen) when you deploy the included Cloudflare Worker and Discord bot

Basic setup only requires Discord webhooks and Reddit app settings. Advanced ticket management requires a Discord bot and Cloudflare Worker (documented below).

## Screenshots

| Discord modmail alert |
| --- |
| ![Discord modmail alert](https://i.imgur.com/yq5VX5o.png) |

## Basic setup

These steps get modmail (and optionally posts/mod queue) flowing to Discord. You do **not** need Cloudflare or a Discord bot for basic webhook notifications.

### 1. Install the app in your subreddit

1. Open [Reddit Modmail to Discord on Devvit](https://developers.reddit.com/apps/modmailmanager).
2. Click **Install** (or **Add to community**) and choose the subreddit where you are a moderator.
3. Approve the permissions the app requests (moderator scope is required to read modmail and mod queue events).
4. After install, open your subreddit’s app settings at:

   `https://developers.reddit.com/r/YOUR_SUBREDDIT_NAME/apps/modmailmanager/`

   Replace `YOUR_SUBREDDIT_NAME` with your subreddit name (without `r/`).

### 2. Create a Discord webhook

You need at least one Discord webhook URL for the channel where alerts should appear.

1. Open Discord and go to the server where you want alerts.
2. Open the **channel** that should receive modmail (for example `#modmail`).
3. Click the **gear icon** next to the channel name to open **Channel Settings**.

### 3. Open Integrations

1. In the left sidebar of Channel Settings, click **Integrations**.
2. Click **Webhooks** (or **Create Webhook** if none exist yet).

### 4. Create a new webhook

1. Click **Create Webhook** (or **New Webhook**).
2. Give the webhook a name (for example `Reddit Modmail`).
3. Optionally set an avatar.
4. Confirm the webhook is assigned to the correct channel.
5. Click **Save** or **Create**.

### 5. Copy the webhook URL

1. After saving, Discord shows the webhook URL.
2. Click **Copy Webhook URL**.

   It looks like:

   `https://discord.com/api/webhooks/1234567890123/abcdefghijklmnopqrstuvwxyz`

   Keep this URL private. Anyone with it can post to your channel.

### 6. Paste the webhook URL into app settings

1. Return to your Reddit app settings page:

   `https://developers.reddit.com/r/YOUR_SUBREDDIT_NAME/apps/modmailmanager/`

2. Paste the copied URL into **Discord Webhook 1 — Modmail**.
3. Optionally add separate webhooks:
   - **Webhook 3 — Mod Queue** for reports and AutoMod (falls back to Webhook 1 if blank)
   - **Webhook 5 — New Posts** for new submissions (falls back to Webhook 1 if blank)
   - **Webhook 7 — Closed Tickets** for archived/closed tickets (requires advanced setup below)
   - **Reporting webhook** for daily stats (any channel you choose)
4. Click **Save Changes**.

### 7. Test it

Send a modmail message to your subreddit (or use a test thread). Within a few seconds you should see an embed in the Discord channel tied to your webhook.

### Optional app settings (no Cloudflare required)

| Setting | Purpose |
| --- | --- |
| **Send outgoing mod messages to Discord** | Also notify when mods send modmail replies |
| **Ignore list** | Comma-separated Reddit usernames to skip (no `u/`) |
| **Discord Role ID to Ping** | Pings a role on new alerts (`<@&ROLE_ID>`) |
| **Only Sync Mod Discussions** | Limit modmail sync to internal mod discussions only |

## What each alert includes

**Modmail**

- Subject and link to the modmail thread
- Author, participant, and participating-as (user vs moderator)
- Message body preview
- Visual distinction for private mod notes vs public messages

**New posts**

- Post title, author, subreddit, and link
- Body preview for text posts

**Mod queue**

- Reported or AutoMod-filtered post/comment details
- Links back to Reddit for review

## Advanced setup: Discord ticket management

Use this when you want moderators to **act on tickets inside Discord** with buttons such as **Claim**, **Close**, **Resolved**, **Unresolved**, **Reassign**, and **Reopen**, move closed tickets to a separate channel, and track button metrics in daily reports.

This requires:

1. A **Discord application / bot** you control
2. A **Cloudflare Worker** (included in this repository) to receive Discord button interactions
3. Matching secrets in **Cloudflare** and **Reddit app settings**

Reddit Devvit cannot receive public inbound webhooks from Discord, so button clicks are handled by the Worker—not by the Reddit app directly.

### Step A — Create a Discord application and bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application**, name it (for example `Modmail Bot`), and create it.
3. Open **Bot** in the left menu → **Add Bot** → confirm.
4. Under **Privileged Gateway Intents**, enable what you need for your server (minimal intents are fine for interactions-only use).
5. Click **Reset Token** → **Copy** the bot token. Store it securely—you will add it to Reddit and Cloudflare.

### Step B — Invite the bot to your Discord server

1. In the Developer Portal, open **OAuth2 → URL Generator**.
2. Scopes: select **bot** (and **applications.commands** if you add slash commands later).
3. Bot permissions: at minimum **Send Messages**, **Embed Links**, **Read Message History**, and **Manage Messages** (needed to edit alert embeds when tickets are claimed/closed).
4. Copy the generated URL, open it in a browser, choose your server, and authorize.

The bot must be in the same server as the channels where your webhooks post alerts.

### Step C — Deploy the Cloudflare Worker

Detailed deploy steps live in [`cloudflare/discord-interactions/README.md`](cloudflare/discord-interactions/README.md). Summary:

1. Fork or clone [Spectrum-Modmail-Bot](https://github.com/MissSicariaTest/Spectrum-Modmail-Bot).
2. In [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Connect to Git**.
3. Select your repository and set **Root directory** to `cloudflare/discord-interactions`.
4. Create two **KV namespaces** (`TICKETS` and `REPORT`) and paste their IDs into `wrangler.toml`.
5. Add Worker **secrets** (Settings → Variables):

   | Secret | Where to get it |
   | --- | --- |
   | `DISCORD_PUBLIC_KEY` | Developer Portal → **General Information → Public Key** |
   | `DISCORD_BOT_TOKEN` | Same bot token from Step A |
   | `WORKER_SECRET` | Generate a long random string (also goes in Reddit settings) |
   | `CLOSED_TICKETS_WEBHOOK_SPECTRUM` *(optional)* | Full Webhook 7 URL if Reddit sync is unavailable |
   | `CLOSED_TICKETS_WEBHOOK_SPECTRUM_OFFICIAL` *(optional)* | Full Webhook 8 URL for a second community |

6. Deploy and copy your Worker URL, for example `https://modmail.your-name.workers.dev`.
7. Verify: `GET https://YOUR-WORKER.workers.dev/api/health` should return `"ok": true`.

### Step D — Point Discord interactions at the Worker

1. Developer Portal → your application → **General Information**.
2. Set **Interactions Endpoint URL** to your Worker URL (for example `https://modmail.your-name.workers.dev`).
3. Save. Discord sends a verification ping; the Worker responds automatically.

### Step E — Configure Reddit app settings for ticket actions

On `https://developers.reddit.com/r/YOUR_SUBREDDIT_NAME/apps/modmailmanager/`:

| Setting | Value |
| --- | --- |
| **Discord Bot Token** | Bot token from Step A (same app as Interactions Endpoint) |
| **Discord Application Public Key** | Public key from Developer Portal |
| **Cloudflare Worker URL** | Your deployed Worker URL (no trailing slash) |
| **Cloudflare Worker shared secret** | Same value as Cloudflare `WORKER_SECRET` |
| **Discord Webhook 7 — Closed Tickets** | Channel webhook where closed/resolved tickets are moved |
| **Discord Webhook 1 — Modmail** | Active ticket alerts (see note below on buttons) |

Save changes, then trigger a **new** modmail alert so the app can sync Webhook 7 to the Worker.

### Role pings with ticket buttons

- Set **Discord Role ID to Ping** in Reddit app settings to ping a role on new alerts.
- The Worker respects assignee pings when tickets are reassigned.

### Why buttons might not appear

Standard channel webhooks (Integrations → Webhooks) send alerts but **may strip interactive components**.

**Fix:** Add your **Discord Bot Token** in Reddit settings and `DISCORD_BOT_TOKEN` on the Worker. The app sends alerts through your bot so Claim/Close/Reassign buttons appear while still routing to your configured channels.

Alerts still work without buttons; ticket actions simply will not be available until the bot + Worker are configured.

## Daily moderation reports

If you set **Webhook URL for the shared daily reporting channel**, the app posts a summary **once per day at 8:00 AM US Eastern**.

Reports include modmail volume, new posts, mod queue activity, response-time averages, ticket actions (from the Worker when configured), and open unclaimed ticket counts.

## Development

```bash
npm install
npm run dev      # watch build for Devvit playtest
npm run build
npm run bump-patch   # upload new Reddit app version
```

Playtest subreddit in `devvit.json`: `modmailmanager_dev`.

Worker development:

```bash
cd cloudflare/discord-interactions
npm install
npm run deploy
```

## Changelog

**Current release**

- Modmail, new post, and mod queue Discord alerts
- Private mod note styling, ignore list, role pings, outgoing message toggle
- Discord ticket buttons (Claim, Close, Resolved, Unresolved, Reassign, Reopen)
- Thread follow-ups in Discord for linked post replies
- Closed-ticket channel (Webhook 7/8) with Worker-backed archive
- Daily moderation reports

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/MissSicariaTest/Spectrum-Modmail-Bot).

## License

This project is licensed under the [MIT License](LICENSE).
