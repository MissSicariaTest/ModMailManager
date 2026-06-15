# Reddit Modmail to Discord

**Reddit Modmail to Discord** sends incoming modmail messages, new posts, and mod queue alerts from your subreddit to Discord channels through webhook payloads so your team is notified when something needs attention.

Source code: [github.com/MissSicariaTest/Spectrum-Modmail-Bot](https://github.com/MissSicariaTest/Spectrum-Modmail-Bot)

## Quick setup

### 1. Install the app

Install [Reddit Modmail to Discord](https://developers.reddit.com/apps/modmailmanager) into your subreddit, then open:

`https://developers.reddit.com/r/YOUR_SUBREDDIT_NAME/apps/modmailmanager/`

### 2. Create a Discord webhook

1. In Discord, open the target channel → **Edit Channel** (gear icon).
2. Go to **Integrations** → **Webhooks**.
3. Click **Create Webhook**, name it, and save.
4. Click **Copy Webhook URL**.

### 3. Add the webhook to app settings

Paste the URL into **Discord Webhook 1 — Modmail** and click **Save Changes**.

Optional: use separate webhooks for mod queue (Webhook 3), new posts (Webhook 5), closed tickets (Webhook 7), and daily reports.

## Features

- Modmail alerts with subject, author, participant, body preview, and mod note styling
- New post and mod queue (report / AutoMod) alerts
- Ignore list, role pings, outgoing mod message toggle, mod-discussion-only mode
- **Advanced:** Claim / Close / Resolved / Unresolved / Reassign / Reopen buttons, closed-ticket queue, thread follow-ups, and daily reports — requires your own Discord bot + Cloudflare Worker (see the GitHub README)

## Advanced ticket management

To manage modmail tickets from Discord with interactive buttons:

1. Create a Discord application and bot in the [Developer Portal](https://discord.com/developers/applications).
2. Invite the bot to your server with message permissions.
3. Deploy the Cloudflare Worker from the GitHub repo (`cloudflare/discord-interactions`).
4. Set the Worker URL as Discord **Interactions Endpoint URL**.
5. Add **Discord Bot Token**, **Public Key**, **Worker URL**, and **Worker shared secret** in this app’s settings.

Full step-by-step instructions: [README on GitHub](https://github.com/MissSicariaTest/Spectrum-Modmail-Bot#advanced-setup-discord-ticket-management).
