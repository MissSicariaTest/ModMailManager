# ModMailModerator

A Devvit app that sends incoming modmail messages, new posts, and mod queue alerts from your subreddit to your Discord channels. It sends the message and other relevant information through a webhook payload so your team can be notified when new messages, posts, or moderation items need attention.

**App:** [developers.reddit.com/apps/modmailmoderator](https://developers.reddit.com/apps/modmailmoderator)  
**Source:** [github.com/MissSicariaTest/ModMailManager](https://github.com/MissSicariaTest/ModMailManager)

---

## Features

- Sends incoming modmail messages to a dedicated Discord channel
- Sends new post alerts to a dedicated Discord channel
- Sends mod queue alerts (user reports and AutoMod filters) to a dedicated Discord channel
- Supports separate webhook URLs for a primary and secondary subreddit
- Supports role pings when new messages arrive
- Supports an ignore list for specific users or moderators
- Supports private mod note detection with custom color coding
- Optional daily moderation reports sent to a reporting channel at 8 AM US Eastern
- Optional Discord ticket management buttons (Claim, Unclaim, Close, Reopen, Resolved, Unresolved, Reassign) — requires a Discord bot and Cloudflare Worker

---

## Setup Instructions

### Step 1 — Install the App

1. Go to [developers.reddit.com/apps/modmailmoderator](https://developers.reddit.com/apps/modmailmoderator)
2. Click **Install**
3. Select the subreddit you want to install it on
4. Approve the requested permissions (moderator scope is required to read modmail and mod queue events)
5. Repeat for each additional subreddit you want to monitor

---

### Step 2 — Create Your Discord Webhooks

You need at least one Discord webhook URL. Create a separate webhook for each channel you want to receive alerts — for example, one for modmail, one for new posts, and one for mod queue.

1. Open your Discord server
2. Right-click the channel you want alerts to go to and select **Edit Channel**
3. Click **Integrations** in the left menu
4. Click **Webhooks**
5. Click **Create Webhook**
6. Give the webhook a descriptive name (for example "Modmail Alerts" or "New Posts")
7. Click **Copy Webhook URL** and save it somewhere secure
8. Repeat for each channel you want to receive alerts

Webhook URLs look like this:

`https://discord.com/api/webhooks/1234567890123/abcdefghijklmnopqrstuvwxyz`

Keep these URLs private. Anyone with a webhook URL can post to that channel.

---

### Step 3 — Add Webhook URLs to App Settings

1. Go to your subreddit's app settings page at:

   `https://developers.reddit.com/r/YOUR-SUBREDDIT-NAME/apps/modmailmoderator`

   Replace `YOUR-SUBREDDIT-NAME` with your subreddit's name (without `r/`).

2. Paste each webhook URL into the corresponding field:
   - **Webhook 1 — Modmail (Primary)** — modmail alerts (also used as fallback for mod queue and new posts if Webhooks 3 or 5 are left blank)
   - **Webhook 3 — Mod Queue (Primary)** — reports and AutoMod filters (optional; falls back to Webhook 1)
   - **Webhook 5 — New Posts (Primary)** — new post submissions (optional; falls back to Webhook 1)
   - **Daily Report Webhook URL** — where the daily moderation summary is posted (optional)

3. Click **Save Changes**

---

### Step 4 — Configure Optional Settings

| Setting | What it does |
| --- | --- |
| **Send outgoing mod messages to Discord** | Also sends Discord alerts when mods reply in modmail |
| **Ignore list** | Comma-separated Reddit usernames to exclude from alerts (no `u/`) |
| **Discord Role ID to Ping** | Pings a Discord role on new alerts |
| **Only Sync Mod Discussions** | When enabled, only internal mod discussions are sent to the webhook |

---

### Step 5 — Role Pings (Optional)

To ping a specific Discord role when a new alert fires:

1. In Discord, open **Server Settings**
2. Click **Roles** and select the role you want to ping
3. Copy the Role ID — you may need **Developer Mode** enabled in Discord User Settings → Advanced → Developer Mode, then right-click the role and select **Copy Role ID**
4. Paste the Role ID into the **Discord Role ID to Ping** field in the app settings
5. Click **Save Changes**

---

### Step 6 — Monitoring a Second Subreddit (Optional)

If your mod team manages two subreddits and you want separate Discord channels for each:

1. Install the app on your second subreddit as well (repeat Step 1)
2. In the app settings, fill in the **Secondary Subreddit Name** field with the second subreddit's name (without `r/`)
3. Add webhook URLs for the secondary subreddit in:
   - **Webhook 2 — Modmail (Secondary)**
   - **Webhook 4 — Mod Queue (Secondary)** (optional)
   - **Webhook 6 — New Posts (Secondary)** (optional)
4. Click **Save Changes**

Events from the secondary subreddit will route to the secondary webhooks. Events from all other subreddits route to the primary webhooks.

---

## Advanced — Discord Ticket Management Bot (Optional)

If you want to manage Reddit modmail tickets inside Discord with interactive buttons (Claim, Unclaim, Close, Reopen, Resolved, Unresolved, Reassign), you need to:

1. Create a Discord application and bot
2. Deploy the included Cloudflare Worker
3. Connect them together via shared secrets

This section walks through each step.

---

### Create a Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** and give it a name (for example "Mod Bot")
3. Click **Bot** in the left menu
4. Click **Add Bot** and confirm
5. Under **Token**, click **Reset Token** and copy the token — save this securely, you will need it later
6. Under **Privileged Gateway Intents**, enable:
   - **Server Members Intent**
   - **Message Content Intent**
7. Click **Save Changes**

---

### Invite the Bot to Your Server

1. In the Developer Portal, click **OAuth2** in the left menu
2. Click **URL Generator**
3. Under **Scopes**, select **bot** and **applications.commands**
4. Under **Bot Permissions**, select:
   - Send Messages
   - Read Message History
   - Add Reactions
   - Manage Messages
   - Use Slash Commands
5. Copy the generated URL at the bottom
6. Paste it into your browser, select your Discord server, and click **Authorize**

The bot must be in the same server as the channels where your webhooks post alerts.

---

### Deploy the Cloudflare Worker

The included Cloudflare Worker (`cloudflare/discord-interactions`) handles Discord button clicks for ticket actions. Reddit Devvit cannot receive inbound webhooks from Discord directly, so this Worker acts as the bridge.

#### Quick deploy via Cloudflare Git integration

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign in
2. Go to **Workers and Pages** → **Create** → **Connect to Git**
3. Select the **MissSicariaTest/ModMailManager** repository (or your fork)
4. Set **Root directory** to `cloudflare/discord-interactions`
5. Set **Build command** to `npm install && npx wrangler deploy`

#### Create KV namespaces

Before deploying, create two KV namespaces in Cloudflare Dashboard → **Workers & Pages → KV**:

| Namespace name | Binding name in wrangler.toml |
| --- | --- |
| `modmail-tickets` (or any name) | `TICKETS` |
| `modmail-report` (or any name) | `REPORT` |

Paste both namespace IDs into `cloudflare/discord-interactions/wrangler.toml`.

#### Add Cloudflare Worker secrets

In **Settings → Variables** (use encrypted secrets):

| Secret name | Where to get it |
| --- | --- |
| `DISCORD_PUBLIC_KEY` | Developer Portal → your app → **General Information → Public Key** |
| `DISCORD_BOT_TOKEN` | The bot token you copied above |
| `WORKER_SECRET` | Generate a long random string — you will use the same value in Reddit app settings |
| `CLOSED_TICKETS_WEBHOOK_PRIMARY` | *(Optional)* Full webhook URL for Webhook 7 (closed tickets fallback) |
| `CLOSED_TICKETS_WEBHOOK_SECONDARY` | *(Optional)* Full webhook URL for Webhook 8 (closed tickets fallback) |

After deploying, copy your Worker URL (for example `https://modmail.your-name.workers.dev`).

#### Verify the Worker is running

```
GET https://YOUR-WORKER.workers.dev/api/health
```

Should return `"ok": true` with your secrets listed.

---

### Point Discord Button Interactions at the Worker

1. In the Discord Developer Portal, open your application
2. Go to **General Information**
3. Set **Interactions Endpoint URL** to your Worker URL (for example `https://modmail.your-name.workers.dev`)
4. Copy the **Public Key** shown on this page — you will need it in the next step
5. Click **Save Changes**

Discord will send a verification ping to the Worker automatically.

---

### Add Secrets to Reddit App Settings

Go to `https://developers.reddit.com/r/YOUR-SUBREDDIT-NAME/apps/modmailmoderator` and fill in:

| Setting | Value |
| --- | --- |
| **Discord Bot Token** | The bot token from your Discord application |
| **Discord Application Public Key** | The Public Key from Developer Portal → General Information |
| **Cloudflare Worker URL** | Your deployed Worker URL (no trailing slash) |
| **Cloudflare Worker Shared Secret** | Same value as `WORKER_SECRET` on the Worker |
| **Webhook 7 — Closed Tickets (Primary)** | Discord webhook for the closed-tickets archive channel |

Click **Save Changes**, then trigger a new alert by sending a modmail to your subreddit. This lets the app sync Webhook 7 to the Worker.

---

### How ticket buttons work

When a modmail or post alert is sent to Discord:

- If a **Discord Bot Token** is configured, the alert is sent through your bot — buttons (Claim, Close, etc.) will appear on the embed
- If no bot token is set, the alert is sent via the standard webhook — buttons may not appear (Discord removes interactive components from non-bot webhooks)
- When a moderator clicks a button in Discord, the Worker receives the interaction, updates the ticket state, and edits the embed in-place
- When a ticket is **Closed**, **Resolved**, or **Unresolved**, the embed is moved to the Webhook 7 channel and removed from the active channel

---

## What each alert includes

**Modmail alerts**

- Subject and link to the modmail thread
- Author, participant name, and participating-as (user vs moderator)
- Message body preview (first 300 characters)
- Visual distinction for private mod notes (green color)
- New account warnings (account under 7 days old or less than 1 karma)
- Role ping if configured

**New post alerts**

- Post title and link
- Author name and subreddit
- Post flair (if any)
- Body preview for text posts
- 10-second delay to skip posts removed by AutoMod before the alert fires

**Mod queue alerts**

- Post or comment title/preview and link
- Author and report reason
- Whether the item was flagged by a user report or AutoMod

---

## Daily moderation reports

If you set a **Daily Report Webhook URL**, the app posts a moderation summary **once per day at 8:00 AM US Eastern**. Reports include:

- Modmail received, response times, resolved/unresolved counts
- New posts submitted, posts with and without mod responses
- Mod queue flagged, approved, and removed counts
- Ticket actions per moderator (Claim, Close, Resolved, etc.) — from the Worker when configured
- Open unclaimed ticket count

Reports reset after each send.

---

## Development

```bash
npm install
npm run dev        # watch build for Devvit playtest
npm run build
npm run bump-patch # build and upload a new version to Reddit
```

Cloudflare Worker development:

```bash
cd cloudflare/discord-interactions
npm install
npm run deploy
```

---

## License

This project is licensed under the [MIT License](LICENSE).

## Contributing

Pull requests and issues are welcome. Feel free to fork and customize this for your own subreddit.
