import {
  MONITORED_SUBREDDITS,
} from "./constants.js";
import type { WebhookCategory } from "./types.js";

export type MonitoredSubreddit = (typeof MONITORED_SUBREDDITS)[number];

export function normalizeSubredditName(name: string): string {
  return name.replace(/^r\//i, "").trim().toLowerCase();
}

/**
 * Maps a subreddit name to a routing group.
 *
 * Any subreddit resolves to "primary" unless it matches the optional
 * secondarySubredditName setting, in which case it resolves to "secondary".
 */
export function resolveSubredditGroup(
  subredditName: string,
  secondarySubredditName?: string | null
): MonitoredSubreddit {
  const normalized = normalizeSubredditName(subredditName);
  if (secondarySubredditName && normalized === normalizeSubredditName(secondarySubredditName)) {
    return "secondary";
  }
  return "primary";
}

/** Always true — any subreddit with a non-empty name is monitored. */
export function isMonitoredSubreddit(subredditName: string): boolean {
  return Boolean(subredditName?.trim());
}

export function getMonitoredSubredditKey(
  subredditName: string,
  secondarySubredditName?: string | null
): MonitoredSubreddit | null {
  if (!isMonitoredSubreddit(subredditName)) {
    return null;
  }
  return resolveSubredditGroup(subredditName, secondarySubredditName);
}

export function getClosedWebhookSettingName(
  subredditName: string,
  secondarySubredditName?: string | null
): string {
  const group = resolveSubredditGroup(subredditName, secondarySubredditName);
  return group === "primary"
    ? "primaryClosedTicketsWebhook"
    : "secondaryClosedTicketsWebhook";
}

export function getWebhookSettingName(
  subredditName: string,
  category: WebhookCategory,
  secondarySubredditName?: string | null
): string {
  const group = resolveSubredditGroup(subredditName, secondarySubredditName);

  if (group === "primary") {
    switch (category) {
      case "modmail":
        return "primaryModmailWebhook";
      case "modqueue":
        return "primaryModQueueWebhook";
      case "newposts":
        return "primaryNewPostsWebhook";
    }
  }

  switch (category) {
    case "modmail":
      return "secondaryModmailWebhook";
    case "modqueue":
      return "secondaryModQueueWebhook";
    case "newposts":
      return "secondaryNewPostsWebhook";
  }
}

export function displaySubredditLabel(subreddit: MonitoredSubreddit): string {
  return subreddit === "secondary" ? "Secondary Subreddit" : "Primary Subreddit";
}

export function displaySubredditFromName(subredditName: string, secondarySubredditName?: string | null): string {
  const group = resolveSubredditGroup(subredditName, secondarySubredditName);
  return displaySubredditLabel(group);
}

export { MONITORED_SUBREDDITS };
