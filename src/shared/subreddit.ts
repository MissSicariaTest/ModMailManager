import {
  MONITORED_SUBREDDITS,
  PLAYTEST_SUBREDDIT,
} from "./constants.js";
import type { WebhookCategory } from "./types.js";

export type MonitoredSubreddit = (typeof MONITORED_SUBREDDITS)[number];

export function normalizeSubredditName(name: string): string {
  return name.replace(/^r\//i, "").trim().toLowerCase();
}

export function resolveSubredditGroup(
  subredditName: string
): MonitoredSubreddit | null {
  const normalized = normalizeSubredditName(subredditName);
  if (normalized === PLAYTEST_SUBREDDIT || normalized === "spectrum") {
    return "spectrum";
  }
  if (normalized === "spectrum_official") {
    return "spectrum_official";
  }
  return null;
}

export function isMonitoredSubreddit(subredditName: string): boolean {
  return resolveSubredditGroup(subredditName) !== null;
}

export function getMonitoredSubredditKey(
  subredditName: string
): MonitoredSubreddit | null {
  return resolveSubredditGroup(subredditName);
}

export function getWebhookSettingName(
  subredditName: string,
  category: WebhookCategory
): string | null {
  const group = resolveSubredditGroup(subredditName);
  if (!group) {
    return null;
  }

  if (group === "spectrum") {
    switch (category) {
      case "modmail":
        return "spectrumModmailWebhook";
      case "modqueue":
        return "spectrumModQueueWebhook";
      case "newposts":
        return "spectrumNewPostsWebhook";
    }
  }

  switch (category) {
    case "modmail":
      return "spectrumOfficialModmailWebhook";
    case "modqueue":
      return "spectrumOfficialModQueueWebhook";
    case "newposts":
      return "spectrumOfficialNewPostsWebhook";
  }
}

export function displaySubredditLabel(subreddit: MonitoredSubreddit): string {
  return subreddit === "spectrum_official" ? "r/Spectrum_Official" : "r/Spectrum";
}

export function displaySubredditFromName(subredditName: string): string {
  const group = resolveSubredditGroup(subredditName);
  if (!group) {
    return subredditName;
  }
  return displaySubredditLabel(group);
}

export { MONITORED_SUBREDDITS };
