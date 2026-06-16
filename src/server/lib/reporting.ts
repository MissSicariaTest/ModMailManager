import { reddit, redis, settings } from "@devvit/web/server";
import {
  DAILY_REPORT_REDIS_KEY,
  DAILY_REPORT_SENT_REDIS_KEY,
  MONITORED_SUBREDDITS,
  REPORT_HOUR,
  REPORT_TIMEZONE,
} from "../../shared/constants.js";
import type {
  DailyReportStore,
  DiscordEmbedField,
  DiscordWebhookPayload,
  SubredditMetrics,
  TicketHandlerStats,
} from "../../shared/types.js";
import type { MonitoredSubreddit } from "../../shared/subreddit.js";
import { displaySubredditLabel } from "../../shared/subreddit.js";
import {
  isDiscordWebhook,
  sendDiscordWebhook,
  truncateField,
  truncateTitle,
} from "./discord.js";
import { countOpenUnclaimedTickets } from "./tickets.js";
import {
  fetchWorkerReportSnapshot,
  resetWorkerReportSnapshot,
  type WorkerReportSnapshot,
} from "./worker-client.js";

const SPECTRUM_BLUE = 0x005fff;

function emptyHandlerStats(): TicketHandlerStats {
  return {};
}

function emptyMetrics(): SubredditMetrics {
  return {
    modmailReceived: 0,
    newPostsSubmitted: 0,
    modQueueFlagged: 0,
    postsWithModResponse: 0,
    postsWithoutModResponse: 0,
    modmailResponseTimeTotalMs: 0,
    modmailResponseTimeSamples: 0,
    postResponseTimeTotalMs: 0,
    postResponseTimeSamples: 0,
    modmailResolved: 0,
    modmailUnresolved: 0,
    modmailAbandoned: 0,
    modQueueApproved: 0,
    modQueueRemoved: 0,
    postsLive: 0,
    postsRemoved: 0,
    ticketsClaimed: 0,
    ticketsClosed: 0,
    ticketsResolved: 0,
    ticketsUnresolved: 0,
    ticketsReassigned: 0,
    ticketsReopened: 0,
  };
}

export function createEmptyDailyReportStore(): DailyReportStore {
  return {
    periodStartedAt: new Date().toISOString(),
    subreddits: {
      spectrum: emptyMetrics(),
      spectrum_official: emptyMetrics(),
    },
    modmailConversations: {},
    trackedPosts: {},
    ticketHandlers: {
      spectrum: emptyHandlerStats(),
      spectrum_official: emptyHandlerStats(),
    },
  };
}

export async function getDailyReportStore(): Promise<DailyReportStore> {
  const storedRaw = await redis.get(DAILY_REPORT_REDIS_KEY);
  if (!storedRaw) {
    return createEmptyDailyReportStore();
  }

  const stored = JSON.parse(storedRaw) as DailyReportStore;
  return {
    ...createEmptyDailyReportStore(),
    ...stored,
    subreddits: {
      spectrum: { ...emptyMetrics(), ...stored.subreddits?.spectrum },
      spectrum_official: { ...emptyMetrics(), ...stored.subreddits?.spectrum_official },
    },
    modmailConversations: stored.modmailConversations ?? {},
    trackedPosts: stored.trackedPosts ?? {},
    ticketHandlers: {
      spectrum: { ...emptyHandlerStats(), ...stored.ticketHandlers?.spectrum },
      spectrum_official: {
        ...emptyHandlerStats(),
        ...stored.ticketHandlers?.spectrum_official,
      },
    },
  };
}

export async function saveDailyReportStore(store: DailyReportStore): Promise<void> {
  await redis.set(DAILY_REPORT_REDIS_KEY, JSON.stringify(store));
}

export async function resetDailyReportStore(): Promise<void> {
  await redis.set(DAILY_REPORT_REDIS_KEY, JSON.stringify(createEmptyDailyReportStore()));
}

export function getMetrics(store: DailyReportStore, subreddit: MonitoredSubreddit): SubredditMetrics {
  return store.subreddits[subreddit];
}

export function getHandlerStats(
  store: DailyReportStore,
  subreddit: MonitoredSubreddit
): TicketHandlerStats {
  return store.ticketHandlers[subreddit];
}

export async function trackTicketActionForReport(
  subreddit: MonitoredSubreddit,
  action: string,
  discordUsername: string
): Promise<void> {
  const store = await getDailyReportStore();
  const metrics = getMetrics(store, subreddit);
  const handlers = getHandlerStats(store, subreddit);

  if (!handlers[discordUsername]) {
    handlers[discordUsername] = {
      claimed: 0,
      closed: 0,
      resolved: 0,
      unresolved: 0,
      reassigned: 0,
      reopened: 0,
    };
  }

  switch (action) {
    case "claim":
      metrics.ticketsClaimed += 1;
      handlers[discordUsername].claimed += 1;
      break;
    case "close":
      metrics.ticketsClosed += 1;
      handlers[discordUsername].closed += 1;
      break;
    case "resolved":
      metrics.ticketsResolved += 1;
      handlers[discordUsername].resolved += 1;
      break;
    case "unresolved":
      metrics.ticketsUnresolved += 1;
      handlers[discordUsername].unresolved += 1;
      break;
    case "reassign":
      metrics.ticketsReassigned += 1;
      handlers[discordUsername].reassigned += 1;
      break;
    case "reopen":
      metrics.ticketsReopened += 1;
      handlers[discordUsername].reopened += 1;
      break;
  }

  await saveDailyReportStore(store);
}

function formatDuration(ms: number): string {
  if (ms <= 0) {
    return "N/A";
  }
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatAverageDuration(totalMs: number, samples: number): string {
  if (samples <= 0) {
    return "N/A";
  }
  return formatDuration(totalMs / samples);
}

function formatReportGeneratedAt(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function formatReportingPeriod(store: DailyReportStore, generatedAt: Date): string {
  return `${store.periodStartedAt} to ${generatedAt.toISOString()}`;
}

function formatWorkerHandlerSummary(
  handlers: Record<string, Record<string, number>>
): string {
  const entries = Object.entries(handlers);
  if (entries.length === 0) {
    return "No Discord ticket actions recorded.";
  }

  return entries
    .map(([username, stats]) => {
      const parts = Object.entries(stats).map(([action, count]) => `${count} ${action}`);
      return `${username}: ${parts.join(", ") || "no actions"}`;
    })
    .join("\n");
}

function formatHandlerSummary(handlers: TicketHandlerStats): string {
  const entries = Object.entries(handlers);
  if (entries.length === 0) {
    return "No Discord ticket actions recorded.";
  }

  return entries
    .map(([username, stats]) => {
      const parts = [
        stats.claimed ? `${stats.claimed} claimed` : "",
        stats.closed ? `${stats.closed} closed` : "",
        stats.resolved ? `${stats.resolved} resolved` : "",
        stats.unresolved ? `${stats.unresolved} unresolved` : "",
        stats.reassigned ? `${stats.reassigned} reassigned` : "",
        stats.reopened ? `${stats.reopened} reopened` : "",
      ].filter(Boolean);
      return `${username}: ${parts.join(", ") || "no actions"}`;
    })
    .join("\n");
}

export function finalizeModmailConversationMetrics(store: DailyReportStore): void {
  for (const subreddit of MONITORED_SUBREDDITS) {
    getMetrics(store, subreddit).modmailUnresolved = 0;
    getMetrics(store, subreddit).modmailAbandoned = 0;
  }

  for (const conversation of Object.values(store.modmailConversations)) {
    if (conversation.resolved) {
      continue;
    }

    const metrics = getMetrics(store, conversation.subreddit);
    if (!conversation.modReplied) {
      metrics.modmailUnresolved += 1;
      continue;
    }

    if (
      conversation.lastModReplyAt !== null &&
      conversation.lastModReplyAt >= conversation.lastUserMessageAt
    ) {
      metrics.modmailAbandoned += 1;
      continue;
    }

    metrics.modmailUnresolved += 1;
  }
}

export function reconcilePostMetrics(store: DailyReportStore): void {
  for (const subreddit of MONITORED_SUBREDDITS) {
    const metrics = getMetrics(store, subreddit);
    metrics.postsWithModResponse = 0;
    metrics.postsWithoutModResponse = 0;
    metrics.postsLive = 0;
    metrics.postsRemoved = 0;
  }

  for (const post of Object.values(store.trackedPosts)) {
    const metrics = getMetrics(store, post.subreddit);
    if (post.hasModResponse) {
      metrics.postsWithModResponse += 1;
    } else {
      metrics.postsWithoutModResponse += 1;
    }

    if (post.isLive) {
      metrics.postsLive += 1;
    } else {
      metrics.postsRemoved += 1;
    }
  }
}

async function buildSubredditReportFields(
  subreddit: MonitoredSubreddit,
  metrics: SubredditMetrics,
  store: DailyReportStore,
  workerSnapshot: WorkerReportSnapshot | null,
  subredditLabel?: string
): Promise<DiscordEmbedField[]> {
  const label = subredditLabel ?? displaySubredditLabel(subreddit);
  const workerMetrics = workerSnapshot?.subreddits[subreddit];
  const openUnclaimed =
    workerMetrics?.openUnclaimed ?? (await countOpenUnclaimedTickets(subreddit));
  const handlerSummary = workerMetrics
    ? formatWorkerHandlerSummary(workerMetrics.handlers)
    : formatHandlerSummary(getHandlerStats(store, subreddit));

  const ticketClaimed = workerMetrics?.ticketsClaimed ?? metrics.ticketsClaimed;
  const ticketClosed = workerMetrics?.ticketsClosed ?? metrics.ticketsClosed;
  const ticketResolved = workerMetrics?.ticketsResolved ?? metrics.ticketsResolved;
  const ticketUnresolved = workerMetrics?.ticketsUnresolved ?? metrics.ticketsUnresolved;
  const ticketReassigned = workerMetrics?.ticketsReassigned ?? metrics.ticketsReassigned;
  const ticketReopened = workerMetrics?.ticketsReopened ?? metrics.ticketsReopened;

  return [
    {
      name: `${label} — New Modmail Messages`,
      value: truncateField(String(metrics.modmailReceived)),
      inline: true,
    },
    {
      name: `${label} — New Posts Submitted`,
      value: truncateField(String(metrics.newPostsSubmitted)),
      inline: true,
    },
    {
      name: `${label} — Mod Queue Items Flagged`,
      value: truncateField(String(metrics.modQueueFlagged)),
      inline: true,
    },
    {
      name: `${label} — Posts With Mod Response`,
      value: truncateField(String(metrics.postsWithModResponse)),
      inline: true,
    },
    {
      name: `${label} — Posts Without Mod Response`,
      value: truncateField(String(metrics.postsWithoutModResponse)),
      inline: true,
    },
    {
      name: `${label} — Avg Modmail Response Time`,
      value: truncateField(
        formatAverageDuration(
          metrics.modmailResponseTimeTotalMs,
          metrics.modmailResponseTimeSamples
        )
      ),
      inline: true,
    },
    {
      name: `${label} — Avg Post Response Time`,
      value: truncateField(
        formatAverageDuration(metrics.postResponseTimeTotalMs, metrics.postResponseTimeSamples)
      ),
      inline: true,
    },
    {
      name: `${label} — Modmail Resolved`,
      value: truncateField(String(metrics.modmailResolved)),
      inline: true,
    },
    {
      name: `${label} — Modmail Unresolved`,
      value: truncateField(String(metrics.modmailUnresolved)),
      inline: true,
    },
    {
      name: `${label} — Modmail Abandoned`,
      value: truncateField(String(metrics.modmailAbandoned)),
      inline: true,
    },
    {
      name: `${label} — Mod Queue Approved`,
      value: truncateField(String(metrics.modQueueApproved)),
      inline: true,
    },
    {
      name: `${label} — Mod Queue Removed`,
      value: truncateField(String(metrics.modQueueRemoved)),
      inline: true,
    },
    {
      name: `${label} — Posts Still Live`,
      value: truncateField(String(metrics.postsLive)),
      inline: true,
    },
    {
      name: `${label} — Posts Removed`,
      value: truncateField(String(metrics.postsRemoved)),
      inline: true,
    },
    {
      name: `${label} — Tickets Claimed`,
      value: truncateField(String(ticketClaimed)),
      inline: true,
    },
    {
      name: `${label} — Tickets Closed`,
      value: truncateField(String(ticketClosed)),
      inline: true,
    },
    {
      name: `${label} — Tickets Resolved`,
      value: truncateField(String(ticketResolved)),
      inline: true,
    },
    {
      name: `${label} — Tickets Unresolved`,
      value: truncateField(String(ticketUnresolved)),
      inline: true,
    },
    {
      name: `${label} — Tickets Reassigned`,
      value: truncateField(String(ticketReassigned)),
      inline: true,
    },
    {
      name: `${label} — Tickets Reopened`,
      value: truncateField(String(ticketReopened)),
      inline: true,
    },
    {
      name: `${label} — Open Unclaimed Tickets`,
      value: truncateField(String(openUnclaimed)),
      inline: true,
    },
    {
      name: `${label} — Discord Handlers`,
      value: truncateField(handlerSummary),
      inline: false,
    },
  ];
}

function getDateKeyInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getLocalHour(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).format(date);
  return Number.parseInt(hour, 10);
}

async function getReportingWebhook(): Promise<string | null> {
  const webhook = (await settings.get("reportingWebhook")) as string | undefined;
  if (!webhook) {
    console.error('No webhook URL configured for setting "reportingWebhook"');
    return null;
  }
  if (!isDiscordWebhook(webhook)) {
    console.error('Setting "reportingWebhook" is not a valid Discord webhook URL');
    return null;
  }
  return webhook;
}

export async function maybeSendDailyReport(): Promise<void> {
  const now = new Date();
  if (getLocalHour(now, REPORT_TIMEZONE) !== REPORT_HOUR) {
    return;
  }

  const todayKey = getDateKeyInTimezone(now, REPORT_TIMEZONE);
  const lastSentDate = await redis.get(DAILY_REPORT_SENT_REDIS_KEY);
  if (lastSentDate === todayKey) {
    return;
  }

  await sendDailyReport();
  await redis.set(DAILY_REPORT_SENT_REDIS_KEY, todayKey);
  await resetDailyReportStore();
  await resetWorkerReportSnapshot();
}

export async function sendDailyReport(): Promise<void> {
  const webhook = await getReportingWebhook();
  if (!webhook) {
    return;
  }

  const secondarySubredditName = ((await settings.get("secondarySubredditName")) as string | undefined)?.trim() || null;

  let primarySubredditName: string;
  try {
    const sub = await reddit.getCurrentSubreddit();
    primarySubredditName = sub.name;
  } catch {
    primarySubredditName = "Primary Subreddit";
  }

  const store = await getDailyReportStore();
  finalizeModmailConversationMetrics(store);
  reconcilePostMetrics(store);
  const workerSnapshot = await fetchWorkerReportSnapshot();

  const generatedAt = new Date();
  const workerNote = workerSnapshot === null
    ? "⚠️ Discord ticket actions unavailable — Worker domain not yet approved in Devvit settings."
    : null;
  const footerText = truncateField(`Report generated ${formatReportGeneratedAt(generatedAt)}${workerNote ? ` | ${workerNote}` : ""}`);
  const periodField: DiscordEmbedField = {
    name: "Reporting Period",
    value: truncateField(formatReportingPeriod(store, generatedAt)),
  };

  const embeds: DiscordWebhookPayload["embeds"] = [
    {
      title: truncateTitle(`Daily Moderation Report — r/${primarySubredditName}`),
      fields: [
        periodField,
        ...(await buildSubredditReportFields(
          "spectrum",
          getMetrics(store, "spectrum"),
          store,
          workerSnapshot,
          `r/${primarySubredditName}`
        )),
      ],
      color: SPECTRUM_BLUE,
      footer: { text: footerText },
    },
  ];

  if (secondarySubredditName) {
    embeds.push({
      title: truncateTitle(`Daily Moderation Report — r/${secondarySubredditName}`),
      fields: await buildSubredditReportFields(
        "spectrum_official",
        getMetrics(store, "spectrum_official"),
        store,
        workerSnapshot,
        `r/${secondarySubredditName}`
      ),
      color: SPECTRUM_BLUE,
      footer: { text: footerText },
    });
  }

  await sendDiscordWebhook(webhook, { embeds });
}

export async function safeTrack(task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (error) {
    console.error("Daily report tracking error:", error instanceof Error ? error.message : String(error));
  }
}
