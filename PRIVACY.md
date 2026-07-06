# Privacy Policy

**ModMailManager**  
Last updated: July 2026

## 1. Overview

ModMailManager ("the App") is a Reddit Devvit application. This Privacy Policy describes what information the App accesses and how it is used.

## 2. Information the App Accesses

The App accesses the following information through Reddit's Devvit platform:

- **Modmail messages** — subject, body, author, and participant information for modmail conversations in your subreddit
- **New post submissions** — post title, body, author, flair, and permalink
- **Mod queue items** — reported or AutoMod-filtered posts and comments, including content previews, author names, and report reasons
- **Reddit user information** — account age and karma, used to generate new account warnings on modmail alerts

## 3. How Information Is Used

- Modmail, post, and mod queue data is formatted into Discord embed messages and sent to the Discord webhook URLs configured by the subreddit moderators.
- Ticket state (claim status, assignee, action history) is stored temporarily in Devvit's Redis storage to support interactive Discord ticket management.
- Aggregated moderation metrics (message counts, response times, ticket action counts) are stored temporarily in Devvit's Redis storage and used to generate daily moderation reports.
- All stored data is scoped to the subreddit installation and is reset after each daily report cycle.

## 4. Optional Ticket Management Service (Cloudflare Worker)

If moderators enable the optional Discord ticket management feature, a companion service (`api.modmailmanager.com`, a Cloudflare Worker operated by the App developer) processes Discord button interactions:

- **What it receives from Discord:** button click events (Claim, Close, Resolved, Unresolved, Reassign, Reopen), the Discord username of the moderator who clicked, and the ticket embed content already visible in the moderators' own Discord channel.
- **What it stores:** ticket state (status, assignee, action history) and aggregated per-moderator action counts, held in Cloudflare KV storage. Ticket records are overwritten as tickets change, and metric counters are reset after each daily reporting cycle.
- **What the Reddit App fetches from it:** only aggregated, numeric action counts (for example, "3 tickets closed today") for inclusion in the daily moderation report. No modmail content, Reddit usernames, or subreddit content is transmitted from Reddit to this service.
- This service is not contacted at all unless moderators explicitly configure it in the App settings.

## 5. Information Shared

- Modmail and moderation data is forwarded only to the Discord webhook URLs and channels that the subreddit moderators configure in the App settings.
- Ticket interaction data is processed by the optional Cloudflare Worker service described in Section 4, solely to provide ticket management features.
- No data is sold, rented, or shared with any other third party.

## 6. Data Retention

- Ticket records and report metrics are stored in Devvit's Redis storage and are automatically cleared after each daily reporting cycle or when tickets are closed.
- The App does not maintain a long-term database of modmail content or user information.

## 7. Security

- Discord webhook URLs and bot tokens are stored in Devvit's encrypted settings storage.
- Moderators are responsible for keeping their webhook URLs and bot tokens secure.

## 8. Children's Privacy

The App is intended for use by Reddit moderators and is not directed at children under 13.

## 9. Changes to This Policy

This Privacy Policy may be updated at any time. The "Last updated" date at the top of this page will reflect any changes.

## 10. Contact

For questions about this Privacy Policy, open an issue on the [GitHub repository](https://github.com/MissSicariaTest/ModMailManager).
