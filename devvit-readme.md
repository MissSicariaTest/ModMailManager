# ModMailModerator

A Devvit app that sends incoming modmail messages, new posts, and mod queue alerts from your subreddit to your Discord channels. It sends the message and other relevant information through a webhook payload so your team can be notified when new messages, posts, or moderation items need attention.

Source code and full documentation: [github.com/MissSicariaTest/ModMailManager](https://github.com/MissSicariaTest/ModMailManager)

---

## Features

- Sends incoming modmail messages to a dedicated Discord channel
- Sends new post alerts to a dedicated Discord channel
- Sends mod queue alerts to a dedicated Discord channel
- Supports separate webhook URLs for a primary and secondary subreddit
- Supports role pings when new messages arrive
- Supports an ignore list for specific users or moderators
- Supports private mod note detection with custom color coding

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

`https://developers.reddit.com/r/YOUR-SUBREDDIT-NAME/apps/modmailmoderator`

Paste each webhook URL into the corresponding field and click **Save Changes**.

- **Webhook 1** — modmail alerts (also used as fallback for mod queue and new posts)
- **Webhook 3** — mod queue alerts (optional)
- **Webhook 5** — new post alerts (optional)
- **Daily Report Webhook** — daily summary (optional, posts at 8 AM US Eastern)

---

### Step 4 — Configure Optional Settings

- **Send outgoing mod messages to Discord** — also alert on mod replies
- **Ignore list** — comma-separated Reddit usernames to exclude
- **Discord Role ID to Ping** — pings a role on new alerts
- **Only Sync Mod Discussions** — limit to internal mod discussions only
- **Secondary Subreddit Name** — if monitoring two subreddits, enter the second one here and fill in Webhooks 2, 4, and 6

---

## Advanced — Discord Ticket Management

To add interactive buttons (Claim, Close, Resolved, Unresolved, Reassign, Reopen) to modmail embeds:

1. Create a Discord application and bot at [discord.com/developers/applications](https://discord.com/developers/applications)
2. Invite the bot to your Discord server
3. Deploy the Cloudflare Worker from the GitHub repository (`cloudflare/discord-interactions`)
4. Add the Worker URL as the Discord **Interactions Endpoint URL**
5. Add the **Discord Bot Token**, **Application Public Key**, **Worker URL**, and **Worker Shared Secret** in the app settings

Full setup guide: [github.com/MissSicariaTest/ModMailManager#advanced--discord-ticket-management-bot-optional](https://github.com/MissSicariaTest/ModMailManager#advanced--discord-ticket-management-bot-optional)
