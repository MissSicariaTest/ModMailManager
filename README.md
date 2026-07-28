# ModMailManager

A Devvit app that sends incoming modmail messages, new posts, and mod queue alerts from your subreddit to your Discord channels. It sends the message and other relevant information through a webhook payload so your team can be notified when new messages, posts, or moderation items need attention.

Source code: [github.com/MissSicariaTest/ModMailManager](https://github.com/MissSicariaTest/ModMailManager)  
Full developer documentation: [DOCS.md](https://github.com/MissSicariaTest/ModMailManager/blob/main/DOCS.md)

---

## Features

- Sends incoming modmail messages to a dedicated Discord channel
- Sends new post alerts to a dedicated Discord channel
- Sends mod queue alerts (reports and AutoMod filters) to a dedicated Discord channel
- Supports separate webhook URLs for a primary and secondary subreddit
- Supports role pings when new messages arrive
- Supports an ignore list for specific users or moderators
- Supports private mod note detection with custom color coding
- New account warnings on modmail alerts (young or low-karma accounts)
- Daily moderation report delivered to a reporting channel at 8 AM US Eastern
- Optional Discord ticket management buttons (Claim, Close, Resolved, Unresolved, Reassign, Reopen) via a self-hosted Cloudflare Worker

---

## Setup Instructions

### Step 1 — Install the App

1. Click **Install** and select the subreddit you want to monitor
2. Approve the permissions the app requests
3. Repeat for any additional subreddits

---

### Step 2 — Create Your Discord Webhooks

For each Discord channel you want to receive alerts:

1. Right-click the channel in Discord and select **Edit Channel**
2. Click **Integrations** → **Webhooks** → **Create Webhook**
3. Give it a name and click **Copy Webhook URL**

---

### Step 3 — Add Webhook URLs to App Settings

Go to your subreddit's app settings at:

`https://developers.reddit.com/r/YOUR-SUBREDDIT-NAME/apps/modmailmanager`

Paste each webhook URL into the corresponding field and click **Save Changes**.

- **Webhook 1 — Modmail** — modmail alerts (also used as fallback for mod queue and new posts)
- **Webhook 3 — Mod Queue** — report and AutoMod alerts (optional)
- **Webhook 5 — New Posts** — new submission alerts (optional)
- **Webhook 7 — Closed Tickets** — archive channel for closed/resolved tickets (used with the advanced ticket buttons)
- **Daily Report Webhook** — daily moderation summary (optional, posts at 8 AM US Eastern)

---

### Step 4 — Configure Optional Settings

- **Send outgoing mod messages to Discord** — also alert on mod replies
- **Ignore list** — comma-separated Reddit usernames to exclude
- **Discord Role ID to Ping** — pings a role on new alerts
- **Only Sync Mod Discussions** — limit to internal mod discussions only
- **Secondary Subreddit Name** — if monitoring two subreddits from one install, enter the second one here and fill in Webhooks 2, 4, 6, and 8

---

## Advanced — Discord Ticket Management

To manage tickets inside Discord with interactive buttons (Claim, Close, Resolved, Unresolved, Reassign, Reopen), a moved closed-ticket queue, and a daily ticket-actions report:

1. Create a Discord application and bot at [discord.com/developers/applications](https://discord.com/developers/applications), and invite the bot to your server
2. Deploy the Cloudflare Worker from the GitHub repository (`cloudflare/discord-interactions`)
3. Set the Worker URL as the Discord **Interactions Endpoint URL** in the Developer Portal
4. In this app's settings, add the **Discord Bot Token** and **Discord Application Public Key**
5. In Cloudflare Worker secrets, add your closed-ticket and reporting channel webhooks

The Reddit app makes no calls to the Worker — all button handling and ticket reporting run between Discord and Cloudflare directly.

Full setup guide: [DOCS.md — Advanced Discord Ticket Management](https://github.com/MissSicariaTest/ModMailManager/blob/main/DOCS.md#advanced--discord-ticket-management-bot-optional)

---

## Credits

This app is based on the original open source project built by [u/ni5arga](https://www.reddit.com/user/ni5arga) ([source](https://github.com/ni5arga/Modmail-To-Discord-Slack)). This version has been forked and customized to support multiple subreddits, separate Discord channels for modmail, new posts, and mod queue alerts, and additional moderation workflow features.
