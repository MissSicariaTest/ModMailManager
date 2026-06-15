import {
  MONITORED_SUBREDDITS,
  PLAYTEST_SUBREDDIT,
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
 * secondarySubredditName, in which case it resolves to "secondary".
 * Both groups are represented by the internal keys "spectrum" (primary)
 * and "spectrum_official" (secondary) for backward-compatibility with
 * existing Redis data.
 */
export function resolveSubredditGroup(
  subredditName: string,
  secondarySubredditName?: string | null
): MonitoredSubreddit {
  const normalized = normalizeSubredditName(subredditName);
  if (secondarySubredditName && normalized === normalizeSubredditName(secondarySubredditName)) {
    return "spectrum_official";
  }
  return "spectrum";
}

/** Always true — any subreddit with a non-empty name is now monitored. */
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
  return group === "spectrum"
    ? "primaryClosedTicketsWebhook"
    : "secondaryClosedTicketsWebhook";
}

export function getWebhookSettingName(
  subredditName: string,
  category: WebhookCategory,
  secondarySubredditName?: string | null
): string {
  const group = resolveSubredditGroup(subredditName, secondarySubredditName);

  if (group === "spectrum") {
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
  return subreddit === "spectrum_official" ? "Secondary Subreddit" : "Primary Subreddit";
}

export function displaySubredditFromName(subredditName: string, secondarySubredditName?: string | null): string {
  const group = resolveSubredditGroup(subredditName, secondarySubredditName);
  return displaySubredditLabel(group);
}

export { MONITORED_SUBREDDITS };
