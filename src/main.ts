import {
  AutomoderatorFilterComment,
  AutomoderatorFilterPost,
  CommentReport,
  MessageData,
  ModMail,
  PostReport,
  PostSubmit,
} from "@devvit/protos";
import { Devvit, JobContext, TriggerContext } from "@devvit/public-api";

const DISCORD_WEBHOOK_HOSTS = [
  "canary.discord.com",
  "ptb.discord.com",
  "discord.com",
  "canary.discordapp.com",
  "ptb.discordapp.com",
  "discordapp.com",
];

const SPECTRUM_BLUE = 0x005fff;
const PRIVATE_NOTE_GREEN = 0x00cc66;
const REPORTED_ORANGE = 0xff4500;
const AUTOMOD_YELLOW = 0xffcc00;
const POST_WHITE = 0xffffff;

const PREVIEW_LENGTH = 300;
const TITLE_LENGTH = 256;
const FIELD_LENGTH = 1024;
const REPORT_TIMEZONE = "America/New_York";
const REPORT_HOUR = 8;
const DAILY_REPORT_JOB_NAME = "dailyReport";
const DAILY_STATS_TTL_SECONDS = 60 * 60 * 24 * 14;
const MONITORED_SUBREDDITS = ["spectrum", "spectrum_official"] as const;

type WebhookCategory = "modmail" | "modqueue" | "newposts";

type DailyStatField =
  | "modmail"
  | "modmail_private"
  | "modqueue_reported_post"
  | "modqueue_reported_comment"
  | "modqueue_automod_post"
  | "modqueue_automod_comment"
  | "newposts";

type DailyActivity = {
  label: string;
  url: string;
};

type DiscordEmbedField = {
  name: string;
  value: string;
  inline?: boolean;
};

type DiscordEmbed = {
  title?: string;
  url?: string;
  description?: string;
  author?: {
    name: string;
    url?: string;
  };
  fields?: DiscordEmbedField[];
  color?: number;
  timestamp?: string;
};

type DiscordWebhookPayload = {
  content?: string;
  embeds: DiscordEmbed[];
};

Devvit.configure({
  http: true,
  redditAPI: true,
  redis: true,
});

Devvit.addSettings([
  {
    type: "string",
    name: "spectrumModmailWebhook",
    label: "Webhook URL for r/Spectrum modmail alerts",
  },
  {
    type: "string",
    name: "spectrumOfficialModmailWebhook",
    label: "Webhook URL for r/Spectrum_Official modmail alerts",
  },
  {
    type: "string",
    name: "spectrumModQueueWebhook",
    label: "Webhook URL for r/Spectrum mod queue alerts",
  },
  {
    type: "string",
    name: "spectrumOfficialModQueueWebhook",
    label: "Webhook URL for r/Spectrum_Official mod queue alerts",
  },
  {
    type: "string",
    name: "spectrumNewPostsWebhook",
    label: "Webhook URL for r/Spectrum new posts alerts",
  },
  {
    type: "string",
    name: "spectrumOfficialNewPostsWebhook",
    label: "Webhook URL for r/Spectrum_Official new posts alerts",
  },
  {
    type: "string",
    name: "reportingWebhook",
    label: "Webhook URL for the shared daily reporting channel",
  },
  {
    type: "boolean",
    name: "outgoing",
    label:
      "Whether to send outgoing messages by mods to the webhook payload (Enabled by default, if disabled outgoing messages by mods will not be sent to the webhook payload.)",
    defaultValue: true,
  },
  {
    type: "string",
    name: "ignoreUsers",
    label: "Ignore list (comma-separated usernames, don't include u/)",
    helpText:
      "Add Reddit usernames (case-insensitive) separated by commas to skip them from webhook payloads (example: username1, username2, username3). This is totally optional.",
  },
  {
    type: "string",
    name: "rolePing",
    label: "Discord Role ID to Ping",
    helpText:
      "Enter a Discord Role ID to ping when a message is sent. Leave blank to disable. This is totally optional.",
  },
  {
    type: "boolean",
    name: "onlyModDiscussions",
    label: "Only Sync Mod Discussions",
    helpText:
      "If enabled, only mod discussion messages will be sent to the webhook. Messages from users will be ignored.",
    defaultValue: false,
  },
]);

Devvit.addTrigger({
  event: "ModMail",
  onEvent: async (event: ModMail, context: TriggerContext) => {
    try {
      if (!context) {
        throw new Error("Context is probably undefined");
      }
      await sendModMailToWebhook(event, context);
    } catch (error) {
      console.error(
        "ModMail trigger error:",
        error instanceof Error ? error.message : String(error)
      );
    }
  },
});

Devvit.addTrigger({
  events: [
    "PostReport",
    "CommentReport",
    "AutomoderatorFilterPost",
    "AutomoderatorFilterComment",
  ],
  onEvent: async (event, context: TriggerContext) => {
    try {
      if (!context) {
        throw new Error("Context is probably undefined");
      }

      switch (event.type) {
        case "PostReport":
          await sendModQueueAlertFromPostReport(event, context);
          break;
        case "CommentReport":
          await sendModQueueAlertFromCommentReport(event, context);
          break;
        case "AutomoderatorFilterPost":
          await sendModQueueAlertFromAutomodPost(event, context);
          break;
        case "AutomoderatorFilterComment":
          await sendModQueueAlertFromAutomodComment(event, context);
          break;
        default:
          console.error("Unhandled mod queue event type");
      }
    } catch (error) {
      console.error(
        "Mod queue trigger error:",
        error instanceof Error ? error.message : String(error)
      );
    }
  },
});

Devvit.addTrigger({
  event: "PostSubmit",
  onEvent: async (event: PostSubmit, context: TriggerContext) => {
    try {
      if (!context) {
        throw new Error("Context is probably undefined");
      }
      await sendNewPostAlert(event, context);
    } catch (error) {
      console.error(
        "PostSubmit trigger error:",
        error instanceof Error ? error.message : String(error)
      );
    }
  },
});

Devvit.addSchedulerJob({
  name: DAILY_REPORT_JOB_NAME,
  onRun: async (_event, context: JobContext) => {
    try {
      await maybeSendDailyReport(context);
    } catch (error) {
      console.error(
        "Daily report scheduler error:",
        error instanceof Error ? error.message : String(error)
      );
    }
  },
});

Devvit.addTrigger({
  events: ["AppInstall", "AppUpgrade"],
  onEvent: async (_event, context: TriggerContext) => {
    try {
      if (!context) {
        throw new Error("Context is probably undefined");
      }
      await ensureDailyReportScheduled(context);
    } catch (error) {
      console.error(
        "App install/upgrade scheduling error:",
        error instanceof Error ? error.message : String(error)
      );
    }
  },
});

function truncateDescription(description: string, maxLength: number = 4096): string {
  if (description.length <= maxLength) {
    return description;
  }
  const truncationIndicator = "... (truncated)";
  return description.substring(0, maxLength - truncationIndicator.length) + truncationIndicator;
}

function truncateField(value: string): string {
  return truncateDescription(value, FIELD_LENGTH);
}

function truncateTitle(value: string): string {
  return truncateDescription(value, TITLE_LENGTH);
}

function previewText(text: string, maxLength: number = PREVIEW_LENGTH): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.substring(0, maxLength)}...`;
}

function normalizeSubredditName(name: string): string {
  return name.replace(/^r\//i, "").trim().toLowerCase();
}

function isMonitoredSubreddit(subredditName: string): boolean {
  const normalized = normalizeSubredditName(subredditName);
  return normalized === "spectrum" || normalized === "spectrum_official";
}

function getWebhookSettingName(
  subredditName: string,
  category: WebhookCategory
): string | null {
  const normalized = normalizeSubredditName(subredditName);

  if (normalized === "spectrum") {
    switch (category) {
      case "modmail":
        return "spectrumModmailWebhook";
      case "modqueue":
        return "spectrumModQueueWebhook";
      case "newposts":
        return "spectrumNewPostsWebhook";
    }
  }

  if (normalized === "spectrum_official") {
    switch (category) {
      case "modmail":
        return "spectrumOfficialModmailWebhook";
      case "modqueue":
        return "spectrumOfficialModQueueWebhook";
      case "newposts":
        return "spectrumOfficialNewPostsWebhook";
    }
  }

  return null;
}

function isDiscordWebhook(webhook: string): boolean {
  return DISCORD_WEBHOOK_HOSTS.some((host) =>
    webhook.startsWith(`https://${host}/api/webhooks/`)
  );
}

function redditProfileUrl(username: string): string {
  return `https://www.reddit.com/u/${username}`;
}

function redditPermalinkUrl(permalink: string): string {
  if (permalink.startsWith("http")) {
    return permalink;
  }
  return `https://www.reddit.com${permalink}`;
}

function toPostId(id: string): string {
  return id.startsWith("t3_") ? id : `t3_${id}`;
}

function toCommentId(id: string): string {
  return id.startsWith("t1_") ? id : `t1_${id}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getDateKeyInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getPreviousDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function getLocalHour(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).format(date);
  return Number.parseInt(hour, 10);
}

function formatReportDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(year, month - 1, day));
}

function displaySubredditLabel(subreddit: string): string {
  return subreddit === "spectrum_official" ? "r/Spectrum_Official" : "r/Spectrum";
}

function dailyStatsKey(dateKey: string, subreddit: string): string {
  return `daily:stats:${dateKey}:${subreddit}`;
}

function dailyActivityKey(dateKey: string, subreddit: string): string {
  return `daily:activity:${dateKey}:${subreddit}`;
}

function parseStatValue(stats: Record<string, string>, field: DailyStatField): number {
  return Number.parseInt(stats[field] ?? "0", 10) || 0;
}

function buildSubredditSummary(stats: Record<string, string>): string {
  const modmail = parseStatValue(stats, "modmail");
  const modmailPrivate = parseStatValue(stats, "modmail_private");
  const reportedPosts = parseStatValue(stats, "modqueue_reported_post");
  const reportedComments = parseStatValue(stats, "modqueue_reported_comment");
  const automodPosts = parseStatValue(stats, "modqueue_automod_post");
  const automodComments = parseStatValue(stats, "modqueue_automod_comment");
  const newPosts = parseStatValue(stats, "newposts");

  const modmailLine =
    modmailPrivate > 0
      ? `Modmail: ${modmail} (${modmailPrivate} private note${modmailPrivate === 1 ? "" : "s"})`
      : `Modmail: ${modmail}`;

  return [
    modmailLine,
    `Mod Queue: ${reportedPosts} reported post${reportedPosts === 1 ? "" : "s"}, ${reportedComments} reported comment${reportedComments === 1 ? "" : "s"}, ${automodPosts} AutoMod post${automodPosts === 1 ? "" : "s"}, ${automodComments} AutoMod comment${automodComments === 1 ? "" : "s"}`,
    `New Posts: ${newPosts}`,
  ].join("\n");
}

async function recordDailyActivity(
  context: TriggerContext,
  subredditName: string,
  stat: DailyStatField,
  activity?: DailyActivity
): Promise<void> {
  const subreddit = normalizeSubredditName(subredditName);
  const dateKey = getDateKeyInTimezone(new Date(), REPORT_TIMEZONE);
  const statsKey = dailyStatsKey(dateKey, subreddit);

  await context.redis.global.hIncrBy(statsKey, stat, 1);
  await context.redis.global.expire(statsKey, DAILY_STATS_TTL_SECONDS);

  if (activity) {
    const activityKey = dailyActivityKey(dateKey, subreddit);
    await context.redis.global.zAdd(activityKey, {
      member: truncateField(`${activity.label}|${activity.url}`),
      score: Date.now(),
    });
    await context.redis.global.expire(activityKey, DAILY_STATS_TTL_SECONDS);
  }
}

async function getReportingWebhook(context: JobContext | TriggerContext): Promise<string | null> {
  const webhook = (await context.settings.get("reportingWebhook")) as string;
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

async function ensureDailyReportScheduled(context: TriggerContext): Promise<void> {
  const existingJobId = await context.redis.global.get("daily:report:cronJobId");
  if (existingJobId) {
    return;
  }

  const cronJobId = await context.scheduler.runJob({
    name: DAILY_REPORT_JOB_NAME,
    cron: "0 * * * *",
  });

  await context.redis.global.set("daily:report:cronJobId", cronJobId);
}

async function maybeSendDailyReport(context: JobContext): Promise<void> {
  const now = new Date();
  if (getLocalHour(now, REPORT_TIMEZONE) !== REPORT_HOUR) {
    return;
  }

  const todayKey = getDateKeyInTimezone(now, REPORT_TIMEZONE);
  const sentKey = `daily:report:sent:${todayKey}`;
  if (await context.redis.global.get(sentKey)) {
    return;
  }

  const reportDateKey = getPreviousDateKey(todayKey);
  await sendDailyReport(context, reportDateKey);
  await context.redis.global.set(sentKey, "1");
  await context.redis.global.expire(sentKey, 60 * 60 * 48);
}

async function sendDailyReport(context: JobContext, reportDateKey: string): Promise<void> {
  const webhook = await getReportingWebhook(context);
  if (!webhook) {
    return;
  }

  const fields: DiscordEmbedField[] = [];
  const totals = {
    modmail: 0,
    modmailPrivate: 0,
    reportedPosts: 0,
    reportedComments: 0,
    automodPosts: 0,
    automodComments: 0,
    newPosts: 0,
  };

  for (const subreddit of MONITORED_SUBREDDITS) {
    const stats = await context.redis.global.hGetAll(dailyStatsKey(reportDateKey, subreddit));
    const modmail = parseStatValue(stats, "modmail");
    const modmailPrivate = parseStatValue(stats, "modmail_private");
    const reportedPosts = parseStatValue(stats, "modqueue_reported_post");
    const reportedComments = parseStatValue(stats, "modqueue_reported_comment");
    const automodPosts = parseStatValue(stats, "modqueue_automod_post");
    const automodComments = parseStatValue(stats, "modqueue_automod_comment");
    const newPosts = parseStatValue(stats, "newposts");

    totals.modmail += modmail;
    totals.modmailPrivate += modmailPrivate;
    totals.reportedPosts += reportedPosts;
    totals.reportedComments += reportedComments;
    totals.automodPosts += automodPosts;
    totals.automodComments += automodComments;
    totals.newPosts += newPosts;

    fields.push({
      name: displaySubredditLabel(subreddit),
      value: truncateField(buildSubredditSummary(stats)),
    });

    const activities = await context.redis.global.zRange(
      dailyActivityKey(reportDateKey, subreddit),
      0,
      4,
      { by: "rank", reverse: true }
    );

    if (activities.length > 0) {
      const highlights = activities
        .map((entry) => {
          const [label, url] = entry.member.split("|");
          return url ? `[${label}](${url})` : label;
        })
        .join("\n");

      fields.push({
        name: `${displaySubredditLabel(subreddit)} Highlights`,
        value: truncateField(highlights || "No highlights recorded."),
      });
    }
  }

  const totalSummary = [
    totals.modmailPrivate > 0
      ? `Modmail: ${totals.modmail} (${totals.modmailPrivate} private note${totals.modmailPrivate === 1 ? "" : "s"})`
      : `Modmail: ${totals.modmail}`,
    `Mod Queue: ${totals.reportedPosts} reported posts, ${totals.reportedComments} reported comments, ${totals.automodPosts} AutoMod posts, ${totals.automodComments} AutoMod comments`,
    `New Posts: ${totals.newPosts}`,
  ].join("\n");

  fields.push({
    name: "Combined Totals",
    value: truncateField(totalSummary),
  });

  const payload: DiscordWebhookPayload = {
    embeds: [
      {
        title: truncateTitle(`Daily Report — ${formatReportDate(reportDateKey)}`),
        description: truncateDescription(
          `Summary of moderation activity for ${formatReportDate(reportDateKey)} (${REPORT_TIMEZONE}).`
        ),
        fields,
        color: SPECTRUM_BLUE,
        timestamp: new Date().toISOString(),
      },
    ],
  };

  await sendDiscordWebhook(webhook, payload);
}

async function getIgnoreList(context: TriggerContext): Promise<string[]> {
  const ignoreListRaw = (await context.settings.get("ignoreUsers")) as string;
  return (ignoreListRaw || "")
    .split(",")
    .map((username) => username.trim().toLowerCase())
    .filter(Boolean);
}

async function getWebhookUrl(
  context: TriggerContext,
  subredditName: string,
  category: WebhookCategory
): Promise<string | null> {
  const settingName = getWebhookSettingName(subredditName, category);
  if (!settingName) {
    console.log(`Subreddit "${subredditName}" is not monitored. Skipping webhook.`);
    return null;
  }

  const webhook = (await context.settings.get(settingName)) as string;
  if (!webhook) {
    console.error(`No webhook URL configured for setting "${settingName}"`);
    return null;
  }

  if (!isDiscordWebhook(webhook)) {
    console.error(`Setting "${settingName}" is not a valid Discord webhook URL`);
    return null;
  }

  return webhook;
}

async function sendDiscordWebhook(
  webhook: string,
  payload: DiscordWebhookPayload
): Promise<void> {
  const response = await fetch(webhook, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.error(`Error sending data to webhook: ${response.status} ${response.statusText}`);
  }
}

async function getNewAccountWarning(
  context: TriggerContext,
  username: string
): Promise<string | undefined> {
  try {
    const user = await context.reddit.getUserByUsername(username);
    if (!user) {
      return undefined;
    }

    const accountAgeMs = Date.now() - user.createdAt.getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const totalKarma = user.linkKarma + user.commentKarma;
    const warnings: string[] = [];

    if (accountAgeMs < sevenDaysMs) {
      warnings.push("account is less than 7 days old");
    }

    if (totalKarma < 1) {
      warnings.push("account has less than 1 karma");
    }

    if (warnings.length === 0) {
      return undefined;
    }

    return `⚠️ Warning: ${warnings.join(" and ")}`;
  } catch (error) {
    console.error("Error checking account age/karma:", getErrorMessage(error));
    return undefined;
  }
}

async function sendModMailToWebhook(event: ModMail, context: TriggerContext) {
  const subredditName =
    event.conversationSubreddit?.name ??
    event.destinationSubreddit?.name ??
    "";

  if (!subredditName || !isMonitoredSubreddit(subredditName)) {
    console.log(`Skipping modmail for unmonitored subreddit "${subredditName || "unknown"}".`);
    return;
  }

  const webhook = await getWebhookUrl(context, subredditName, "modmail");
  if (!webhook) {
    return;
  }

  const outgoing = (await context.settings.get("outgoing")) as boolean;
  const rolePing = (await context.settings.get("rolePing")) as string | undefined;
  const onlyModDiscussions = (await context.settings.get("onlyModDiscussions")) as boolean;
  const ignoreList = await getIgnoreList(context);

  const conversationId = event.conversationId ?? "";
  const actualConversationId = conversationId.replace("ModmailConversation_", "");
  const result = await context.reddit.modMail.getConversation({
    conversationId,
    markRead: false,
  });

  const isModDiscussion = result.conversation?.isInternal ?? false;
  if (onlyModDiscussions && !isModDiscussion) {
    console.log("Skipping regular modmail because only mod discussions are enabled.");
    return;
  }

  const modmailLink = `https://reddit.com/mail/all/${actualConversationId}`;
  const messages = result.conversation?.messages ?? {};
  const message: MessageData | undefined =
    (event.messageId ? messages[event.messageId] : undefined) ??
    (() => {
      const messageIds = Object.keys(messages);
      const lastMessageId =
        messageIds.length > 0 ? messageIds[messageIds.length - 1] : undefined;
      return lastMessageId ? messages[lastMessageId] : undefined;
    })();

  if (!message) {
    console.error("No messages found");
    return;
  }

  const authorName =
    message.author?.name ?? event.messageAuthor?.name ?? "Unknown";
  const body = message.bodyMarkdown ?? message.body ?? "";
  const participatingAs =
    message.participatingAs ?? event.messageAuthorType ?? "Unknown";
  const participantName = result.conversation?.participant?.name ?? "N/A";
  const isPrivateNote = message.isInternal ?? false;

  if (ignoreList.includes(authorName.toLowerCase())) {
    console.log(`User "${authorName}" is in the ignore list. Skipping webhook.`);
    return;
  }

  if (participatingAs === "moderator" && !outgoing) {
    console.log("Not sending outgoing messages to the webhook");
    return;
  }

  const displaySubreddit = normalizeSubredditName(subredditName);
  const payload: DiscordWebhookPayload = {
    content: rolePing ? `<@&${rolePing}>` : undefined,
    embeds: [
      {
        title: truncateTitle(result.conversation?.subject ?? "Modmail"),
        url: modmailLink,
        author: {
          name: authorName,
          url: redditProfileUrl(authorName),
        },
        fields: [
          {
            name: "Subreddit",
            value: truncateField(`r/${displaySubreddit}`),
            inline: true,
          },
          {
            name: "Participating As",
            value: truncateField(participatingAs),
            inline: true,
          },
          {
            name: "Participant",
            value: truncateField(participantName),
            inline: true,
          },
          {
            name: "Message Preview",
            value: truncateField(previewText(body)),
          },
        ],
        color: isPrivateNote ? PRIVATE_NOTE_GREEN : SPECTRUM_BLUE,
        timestamp: new Date().toISOString(),
      },
    ],
  };

  await sendDiscordWebhook(webhook, payload);

  await recordDailyActivity(context, subredditName, "modmail", {
    label: result.conversation?.subject ?? "Modmail",
    url: modmailLink,
  });
  if (isPrivateNote) {
    await recordDailyActivity(context, subredditName, "modmail_private");
  }
}

async function sendModQueueEmbed(
  context: TriggerContext,
  subredditName: string,
  options: {
    title: string;
    url: string;
    username: string;
    contentType: "post" | "comment";
    reason: string;
    contentPreview: string;
    isAutomod: boolean;
    statField: DailyStatField;
  }
): Promise<void> {
  if (!isMonitoredSubreddit(subredditName)) {
    console.log(`Skipping mod queue alert for unmonitored subreddit "${subredditName}".`);
    return;
  }

  const webhook = await getWebhookUrl(context, subredditName, "modqueue");
  if (!webhook) {
    return;
  }

  const warning = await getNewAccountWarning(context, options.username);
  const displaySubreddit = normalizeSubredditName(subredditName);
  const fields: DiscordEmbedField[] = [
    {
      name: "Subreddit",
      value: truncateField(`r/${displaySubreddit}`),
      inline: true,
    },
    {
      name: "Content Type",
      value: truncateField(options.contentType),
      inline: true,
    },
    {
      name: "Reason",
      value: truncateField(options.reason || "Unknown"),
      inline: true,
    },
    {
      name: "Content Preview",
      value: truncateField(previewText(options.contentPreview)),
    },
  ];

  if (warning) {
    fields.push({
      name: "Account Warning",
      value: truncateField(warning),
    });
  }

  const payload: DiscordWebhookPayload = {
    embeds: [
      {
        title: truncateTitle(options.title),
        url: options.url,
        author: {
          name: options.username,
          url: redditProfileUrl(options.username),
        },
        fields,
        color: options.isAutomod ? AUTOMOD_YELLOW : REPORTED_ORANGE,
        timestamp: new Date().toISOString(),
      },
    ],
  };

  await sendDiscordWebhook(webhook, payload);

  await recordDailyActivity(context, subredditName, options.statField, {
    label: options.title,
    url: options.url,
  });
}

async function sendModQueueAlertFromPostReport(
  event: PostReport,
  context: TriggerContext
) {
  const subredditName = event.subreddit?.name ?? "";
  const post = event.post;

  if (!subredditName || !post) {
    console.error("PostReport event is missing subreddit or post data");
    return;
  }

  const redditPost = await context.reddit.getPostById(toPostId(post.id));
  const username = redditPost.authorName ?? "Unknown";
  const contentPreview = post.selftext || post.title || "";
  const title = post.title || previewText(contentPreview, 100);

  await sendModQueueEmbed(context, subredditName, {
    title,
    url: redditPermalinkUrl(post.permalink),
    username,
    contentType: "post",
    reason: event.reason,
    contentPreview,
    isAutomod: false,
    statField: "modqueue_reported_post",
  });
}

async function sendModQueueAlertFromCommentReport(
  event: CommentReport,
  context: TriggerContext
) {
  const subredditName = event.subreddit?.name ?? "";
  const comment = event.comment;

  if (!subredditName || !comment) {
    console.error("CommentReport event is missing subreddit or comment data");
    return;
  }

  const contentPreview = comment.body ?? "";
  const title = previewText(contentPreview, 100) || "Reported Comment";

  await sendModQueueEmbed(context, subredditName, {
    title,
    url: redditPermalinkUrl(comment.permalink),
    username: comment.author || "Unknown",
    contentType: "comment",
    reason: event.reason,
    contentPreview,
    isAutomod: false,
    statField: "modqueue_reported_comment",
  });
}

async function sendModQueueAlertFromAutomodPost(
  event: AutomoderatorFilterPost,
  context: TriggerContext
) {
  const subredditName = event.subreddit?.name ?? "";
  const post = event.post;

  if (!subredditName || !post) {
    console.error("AutomoderatorFilterPost event is missing subreddit or post data");
    return;
  }

  const username = event.author || "Unknown";
  const contentPreview = post.selftext || post.title || "";
  const title = post.title || previewText(contentPreview, 100);

  await sendModQueueEmbed(context, subredditName, {
    title,
    url: redditPermalinkUrl(post.permalink),
    username,
    contentType: "post",
    reason: event.reason,
    contentPreview,
    isAutomod: true,
    statField: "modqueue_automod_post",
  });
}

async function sendModQueueAlertFromAutomodComment(
  event: AutomoderatorFilterComment,
  context: TriggerContext
) {
  const subredditName = event.subreddit?.name ?? "";
  const comment = event.comment;

  if (!subredditName || !comment) {
    console.error("AutomoderatorFilterComment event is missing subreddit or comment data");
    return;
  }

  const contentPreview = comment.body ?? "";
  const title = previewText(contentPreview, 100) || "AutoMod Filtered Comment";

  await sendModQueueEmbed(context, subredditName, {
    title,
    url: redditPermalinkUrl(comment.permalink),
    username: event.author || comment.author || "Unknown",
    contentType: "comment",
    reason: event.reason,
    contentPreview,
    isAutomod: true,
    statField: "modqueue_automod_comment",
  });
}

async function sendNewPostAlert(event: PostSubmit, context: TriggerContext) {
  const subredditName = event.subreddit?.name ?? "";
  const post = event.post;
  const author = event.author;

  if (!subredditName || !post) {
    console.error("PostSubmit event is missing subreddit or post data");
    return;
  }

  if (!isMonitoredSubreddit(subredditName)) {
    console.log(`Skipping new post alert for unmonitored subreddit "${subredditName}".`);
    return;
  }

  await sleep(10_000);

  const livePost = await context.reddit.getPostById(toPostId(post.id));
  if (livePost.removed) {
    console.log(`Post ${post.id} was removed before alert could be sent. Skipping.`);
    return;
  }

  const webhook = await getWebhookUrl(context, subredditName, "newposts");
  if (!webhook) {
    return;
  }

  const username = author?.name ?? livePost.authorName ?? "Unknown";
  const postUrl = redditPermalinkUrl(post.permalink);
  const flairText = post.linkFlair?.text?.trim();
  const bodyPreview = post.isSelf ? previewText(post.selftext ?? "") : "";
  const displaySubreddit = normalizeSubredditName(subredditName);

  const fields: DiscordEmbedField[] = [
    {
      name: "Subreddit",
      value: truncateField(`r/${displaySubreddit}`),
      inline: true,
    },
  ];

  if (flairText) {
    fields.push({
      name: "Post Flair",
      value: truncateField(flairText),
      inline: true,
    });
  }

  if (bodyPreview) {
    fields.push({
      name: "Post Preview",
      value: truncateField(bodyPreview),
    });
  }

  const payload: DiscordWebhookPayload = {
    embeds: [
      {
        title: truncateTitle(post.title),
        url: postUrl,
        author: {
          name: username,
          url: redditProfileUrl(username),
        },
        fields,
        color: flairText ? SPECTRUM_BLUE : POST_WHITE,
        timestamp: new Date().toISOString(),
      },
    ],
  };

  await sendDiscordWebhook(webhook, payload);

  await recordDailyActivity(context, subredditName, "newposts", {
    label: post.title,
    url: postUrl,
  });
}

export default Devvit;
