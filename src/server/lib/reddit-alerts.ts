import { reddit, settings } from "@devvit/web/server";
import type {
  AutomoderatorFilterComment,
  AutomoderatorFilterPost,
  CommentReport,
  CommentSubmit,
  CommentCreate,
  ModAction,
  ModMail,
  PostReport,
  PostSubmit,
  PostUpdate,
} from "@devvit/protos";
import {
  AUTOMOD_YELLOW,
  MOD_QUEUE_APPROVE_ACTIONS,
  MOD_QUEUE_REMOVE_ACTIONS,
  POST_WHITE,
  PRIVATE_NOTE_GREEN,
  REPORTED_ORANGE,
  SPECTRUM_BLUE,
} from "../../shared/constants.js";
import {
  getMonitoredSubredditKey,
  getClosedWebhookSettingName,
  getWebhookSettingName,
  isMonitoredSubreddit,
  normalizeSubredditName,
  resolveSubredditGroup,
} from "../../shared/subreddit.js";
import type {
  DiscordEmbed,
  DiscordEmbedField,
  DiscordWebhookPayload,
  RedditTicketKeyType,
  TicketRecord,
  TicketSource,
  WebhookCategory,
} from "../../shared/types.js";
import {
  buildTicketButtons,
  buildTicketEmbed,
  buildTicketPayload,
  createDiscordThreadFromMessage,
  createTicketId,
  editDiscordBotMessage,
  getErrorMessage,
  getWebhookChannelId,
  isDiscordWebhook,
  messageHasInteractiveButtons,
  parseWebhookUrl,
  previewText,
  redditPermalinkUrl,
  redditProfileUrl,
  sendDiscordBotMessage,
  sendDiscordWebhook,
  sleep,
  truncateField,
  truncateTitle,
} from "./discord.js";
import {
  getDailyReportStore,
  getMetrics,
  saveDailyReportStore,
} from "./reporting.js";
import {
  getTicket,
  getTicketIdForRedditKey,
  isActiveTicket,
  isPostAlertPending,
  linkRedditKeyToTicket,
  markCommentFollowUpHandled,
  markPostAlertPending,
  clearPostAlertPending,
  saveTicket,
  unlinkRedditKey,
} from "./tickets.js";

function toPostId(id: string): `t3_${string}` {
  return (id.startsWith("t3_") ? id : `t3_${id}`) as `t3_${string}`;
}

async function getIgnoreList(): Promise<string[]> {
  const ignoreListRaw = (await settings.get("ignoreUsers")) as string | undefined;
  return (ignoreListRaw || "")
    .split(",")
    .map((username) => username.trim().toLowerCase())
    .filter(Boolean);
}

async function getSecondarySubredditName(): Promise<string | null> {
  const name = ((await settings.get("secondarySubredditName")) as string | undefined)?.trim();
  return name || null;
}

async function getWebhookUrl(
  subredditName: string,
  category: WebhookCategory
): Promise<string | null> {
  const secondary = await getSecondarySubredditName();
  const settingName = getWebhookSettingName(subredditName, category, secondary);

  let webhook = (await settings.get(settingName)) as string | undefined;
  let resolvedSettingName = settingName;

  if (!webhook && category !== "modmail") {
    const modmailSettingName = getWebhookSettingName(subredditName, "modmail", secondary);
    const modmailWebhook = (await settings.get(modmailSettingName)) as string | undefined;
    if (modmailWebhook) {
      webhook = modmailWebhook;
      resolvedSettingName = modmailSettingName;
      console.log(
        `No webhook configured for "${settingName}"; using "${modmailSettingName}" as fallback for ${category}.`
      );
    }
  }

  if (!webhook) {
    console.error(
      `No webhook URL configured for setting "${settingName}". Open the app settings page for this subreddit and fill in the matching Discord Webhook field, then click Save Changes.`
    );
    return null;
  }

  if (!isDiscordWebhook(webhook)) {
    console.error(`Setting "${resolvedSettingName}" is not a valid Discord webhook URL`);
    return null;
  }

  return webhook;
}

async function getNewAccountWarning(username: string): Promise<string | undefined> {
  try {
    const user = await reddit.getUserByUsername(username);
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

async function getClosedWebhookUrl(subredditName: string): Promise<string | null> {
  const secondary = await getSecondarySubredditName();
  const settingName = getClosedWebhookSettingName(subredditName, secondary);

  const webhook = (await settings.get(settingName)) as string | undefined;
  if (!webhook) {
    return null;
  }

  if (!isDiscordWebhook(webhook)) {
    console.error(`Setting "${settingName}" is not a valid Discord webhook URL`);
    return null;
  }

  return webhook;
}

async function getDiscordBotToken(): Promise<string | null> {
  const botToken = ((await settings.get("discordBotToken")) as string | undefined)?.trim();
  return botToken || null;
}

async function resolveActiveTicketForFollowUp(
  type: RedditTicketKeyType,
  redditKey: string
): Promise<TicketRecord | null> {
  const ticketId = await getTicketIdForRedditKey(type, redditKey);
  if (!ticketId) {
    return null;
  }

  const ticket = await getTicket(ticketId);
  if (!ticket) {
    return null;
  }

  if (!isActiveTicket(ticket) || !ticket.messageId) {
    return null;
  }

  return ticket;
}

async function waitForActivePostTicket(postId: string): Promise<TicketRecord | null> {
  let ticket = await resolveActiveTicketForFollowUp("post", postId);
  if (ticket) {
    return ticket;
  }

  if (!(await isPostAlertPending(postId))) {
    return null;
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(2000);
    ticket = await resolveActiveTicketForFollowUp("post", postId);
    if (ticket) {
      return ticket;
    }
    if (!(await isPostAlertPending(postId))) {
      return null;
    }
  }

  return null;
}

async function resolvePostTicketForFollowUp(postId: string): Promise<TicketRecord | null> {
  return (await waitForActivePostTicket(postId)) ?? (await resolveActiveTicketForFollowUp("post", postId));
}

async function buildFollowUpPing(
  ticket: TicketRecord,
  pingAssignee: boolean
): Promise<Pick<DiscordWebhookPayload, "content" | "allowed_mentions">> {
  if (pingAssignee && ticket.status === "claimed" && ticket.assignedToId) {
    return {
      content: `<@${ticket.assignedToId}>`,
      allowed_mentions: { parse: [], users: [ticket.assignedToId] },
    };
  }

  const rolePing = ((await settings.get("rolePing")) as string | undefined)?.trim();
  if (rolePing) {
    return {
      content: `<@&${rolePing}>`,
      allowed_mentions: { parse: [], roles: [rolePing] },
    };
  }

  return {};
}

async function ensureTicketThread(
  ticket: TicketRecord,
  botToken: string,
  threadName?: string
): Promise<string | null> {
  if (ticket.threadId) {
    return ticket.threadId;
  }

  if (!ticket.channelId || !ticket.messageId) {
    return null;
  }

  const name =
    threadName ??
    (typeof ticket.baseEmbed.title === "string" ? ticket.baseEmbed.title : "Ticket updates");
  const threadId = await createDiscordThreadFromMessage(
    botToken,
    ticket.channelId,
    ticket.messageId,
    name
  );

  if (!threadId) {
    return null;
  }

  ticket.threadId = threadId;
  await saveTicket(ticket);
  return threadId;
}

async function postTicketFollowUp(
  ticket: TicketRecord,
  options: {
    title: string;
    previewFieldName: string;
    preview: string;
    authorName: string;
    url?: string;
    color: number;
    pingAssignee?: boolean;
  }
): Promise<boolean> {
  const botToken = await getDiscordBotToken();
  if (!botToken || !ticket.messageId || !ticket.channelId) {
    return false;
  }

  const fields = [...(ticket.baseEmbed.fields ?? [])];
  const previewIndex = fields.findIndex((field) => field.name === options.previewFieldName);
  if (previewIndex >= 0) {
    fields[previewIndex] = {
      ...fields[previewIndex],
      value: truncateField(previewText(options.preview)),
    };
  }

  ticket.baseEmbed = {
    ...ticket.baseEmbed,
    fields,
  };
  ticket.updatedAt = new Date().toISOString();

  const editResult = await editDiscordBotMessage(
    botToken,
    ticket.channelId,
    ticket.messageId,
    buildTicketPayload(ticket)
  );

  if (editResult === "not_found") {
    // The base message is gone — the Worker closed/moved this ticket in
    // Discord. Mark the Redis copy dead so the caller sends a fresh alert
    // instead of posting follow-ups into deleted messages or orphaned threads.
    ticket.archived = true;
    await saveTicket(ticket);
    return false;
  }

  const ping = await buildFollowUpPing(ticket, options.pingAssignee ?? false);
  const threadId = await ensureTicketThread(ticket, botToken, options.title);
  const destinationChannelId = threadId ?? ticket.channelId;
  const followUpEmbed = {
    title: truncateTitle(options.title),
    url: options.url,
    author: {
      name: options.authorName,
      url: redditProfileUrl(options.authorName),
    },
    description: truncateField(previewText(options.preview)),
    color: options.color,
    timestamp: new Date().toISOString(),
  };

  const followUpMessage = await sendDiscordBotMessage(botToken, destinationChannelId, {
    ...ping,
    embeds: [followUpEmbed],
    ...(threadId
      ? {}
      : {
          message_reference: {
            message_id: ticket.messageId,
            channel_id: ticket.channelId,
            fail_if_not_exists: false,
          },
        }),
  });

  if (!followUpMessage) {
    return false;
  }

  await saveTicket(ticket);
  return true;
}

async function sendTicketAlert(options: {
  webhook: string;
  source: TicketSource;
  subredditName: string;
  embed: DiscordEmbed;
  baseColor: number;
  content?: string;
  redditKey?: string;
  redditKeyType?: RedditTicketKeyType;
  threadName?: string;
}): Promise<void> {
  const parsed = parseWebhookUrl(options.webhook);
  if (!parsed) {
    console.error("Unable to parse Discord webhook URL for ticket tracking.");
    return;
  }

  const secondary = await getSecondarySubredditName();
  const subreddit = resolveSubredditGroup(options.subredditName, secondary);

  if (options.redditKey && options.redditKeyType) {
    await unlinkRedditKey(options.redditKeyType, options.redditKey);
  }

  const closedWebhook = await getClosedWebhookUrl(options.subredditName);
  const closedParsed = closedWebhook ? parseWebhookUrl(closedWebhook) : null;

  const ticketId = createTicketId();
  const now = new Date().toISOString();
  const draftTicket: TicketRecord = {
    id: ticketId,
    source: options.source,
    subreddit,
    status: "open",
    webhookId: parsed.id,
    webhookToken: parsed.token,
    messageId: "",
    channelId: "",
    redditKey: options.redditKey,
    redditKeyType: options.redditKeyType,
    closedWebhookId: closedParsed?.id,
    closedWebhookToken: closedParsed?.token,
    baseEmbed: options.embed,
    baseColor: options.baseColor,
    content: options.content,
    actionLog: [],
    createdAt: now,
    updatedAt: now,
  };

  const payload = {
    content: options.content,
    embeds: [buildTicketEmbed(draftTicket)],
    components: buildTicketButtons(ticketId, "open"),
  };

  const botToken = await getDiscordBotToken();
  let message: Awaited<ReturnType<typeof sendDiscordWebhook>> = null;
  let buttonsAttached = false;

  if (botToken) {
    const channelId = await getWebhookChannelId(parsed.id, parsed.token);
    if (channelId) {
      message = await sendDiscordBotMessage(botToken, channelId, payload);
      buttonsAttached = message ? messageHasInteractiveButtons(message) : false;
      if (message && !buttonsAttached) {
        console.error(
          "Discord bot message was sent without interactive buttons. Confirm the bot is in the server, can send messages in the channel, and belongs to the same application as your Interactions Endpoint."
        );
      }
    } else {
      console.error("Could not resolve the Discord channel from the webhook URL for bot delivery.");
    }
  }

  if (!message) {
    message = await sendDiscordWebhook(options.webhook, payload, true);
    buttonsAttached = message ? messageHasInteractiveButtons(message) : false;

    if (message && payload.components && !buttonsAttached) {
      console.error(
        "Discord accepted the alert but removed interactive buttons. Add your Discord Bot Token in app settings to enable buttons with regular channel webhooks."
      );
    }
  }

  if (!message) {
    console.warn(
      "Ticket alert with buttons failed; retrying with embed-only payload."
    );
    message = await sendDiscordWebhook(
      options.webhook,
      {
        content: options.content,
        embeds: [options.embed],
      },
      true
    );
    buttonsAttached = false;
    if (!message) {
      console.error("Failed to send Discord alert after embed-only fallback.");
      return;
    }
  }

  draftTicket.messageId = message.id;
  draftTicket.channelId = message.channel_id;

  if (botToken && options.threadName) {
    const threadId = await createDiscordThreadFromMessage(
      botToken,
      draftTicket.channelId,
      draftTicket.messageId,
      options.threadName
    );
    if (threadId) {
      draftTicket.threadId = threadId;
    } else {
      console.error("Failed to create Discord thread for ticket follow-ups.");
    }
  }

  const shouldPersistTicket =
    buttonsAttached || Boolean(draftTicket.threadId && options.redditKey && options.redditKeyType);

  if (shouldPersistTicket) {
    if (options.redditKey && options.redditKeyType) {
      await linkRedditKeyToTicket(options.redditKeyType, options.redditKey, draftTicket.id);
    }
    await saveTicket(draftTicket);
  }
}

export async function sendModMailToWebhook(event: ModMail): Promise<void> {
  const subredditName =
    event.conversationSubreddit?.name ?? event.destinationSubreddit?.name ?? "";

  if (!subredditName || !isMonitoredSubreddit(subredditName)) {
    console.log(`Skipping modmail for unmonitored subreddit "${subredditName || "unknown"}".`);
    return;
  }

  const webhook = await getWebhookUrl(subredditName, "modmail");
  if (!webhook) {
    return;
  }

  const outgoing = (await settings.get("outgoing")) as boolean | undefined;
  const rolePing = (await settings.get("rolePing")) as string | undefined;
  const onlyModDiscussions = (await settings.get("onlyModDiscussions")) as boolean | undefined;
  const ignoreList = await getIgnoreList();

  const conversationId = event.conversationId ?? "";
  const actualConversationId = conversationId.replace("ModmailConversation_", "");
  const result = await reddit.modMail.getConversation({
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
  const message =
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

  const authorName = message.author?.name ?? event.messageAuthor?.name ?? "Unknown";
  const body = message.bodyMarkdown ?? message.body ?? "";
  const participatingAs = message.participatingAs ?? event.messageAuthorType ?? "Unknown";
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

  if (conversationId) {
    const activeTicket = await resolveActiveTicketForFollowUp("modmail", conversationId);
    if (activeTicket) {
      const handled = await postTicketFollowUp(activeTicket, {
        title: isPrivateNote ? "New mod note" : "New modmail reply",
        previewFieldName: "Message Preview",
        preview: body,
        authorName,
        url: modmailLink,
        color: isPrivateNote ? PRIVATE_NOTE_GREEN : SPECTRUM_BLUE,
        pingAssignee: participatingAs !== "moderator",
      });
      if (handled) {
        return;
      }
    }
  }

  const displaySubreddit = normalizeSubredditName(subredditName);
  const embed: DiscordEmbed = {
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
  };

  await sendTicketAlert({
    webhook,
    source: "modmail",
    subredditName,
    embed,
    baseColor: isPrivateNote ? PRIVATE_NOTE_GREEN : SPECTRUM_BLUE,
    content: rolePing ? `<@&${rolePing}>` : undefined,
    redditKey: conversationId,
    redditKeyType: "modmail",
    threadName: result.conversation?.subject ?? "Modmail",
  });
}

async function sendModQueueEmbed(
  subredditName: string,
  options: {
    title: string;
    url: string;
    username: string;
    contentType: "post" | "comment";
    reason: string;
    contentPreview: string;
    isAutomod: boolean;
  }
): Promise<void> {
  if (!isMonitoredSubreddit(subredditName)) {
    console.log(`Skipping mod queue alert for unmonitored subreddit "${subredditName}".`);
    return;
  }

  const webhook = await getWebhookUrl(subredditName, "modqueue");
  if (!webhook) {
    return;
  }

  const warning = await getNewAccountWarning(options.username);
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

  const color = options.isAutomod ? AUTOMOD_YELLOW : REPORTED_ORANGE;
  await sendTicketAlert({
    webhook,
    source: "modqueue",
    subredditName,
    embed: {
      title: truncateTitle(options.title),
      url: options.url,
      author: {
        name: options.username,
        url: redditProfileUrl(options.username),
      },
      fields,
      color,
      timestamp: new Date().toISOString(),
    },
    baseColor: color,
  });
}

export async function sendModQueueAlertFromPostReport(event: PostReport): Promise<void> {
  const subredditName = event.subreddit?.name ?? "";
  const post = event.post;

  if (!subredditName || !post) {
    console.error("PostReport event is missing subreddit or post data");
    return;
  }

  const redditPost = await reddit.getPostById(toPostId(post.id));
  const username = redditPost.authorName ?? "Unknown";
  const contentPreview = post.selftext || post.title || "";
  const title = post.title || previewText(contentPreview, 100);

  await sendModQueueEmbed(subredditName, {
    title,
    url: redditPermalinkUrl(post.permalink),
    username,
    contentType: "post",
    reason: event.reason,
    contentPreview,
    isAutomod: false,
  });
}

export async function sendModQueueAlertFromCommentReport(event: CommentReport): Promise<void> {
  const subredditName = event.subreddit?.name ?? "";
  const comment = event.comment;

  if (!subredditName || !comment) {
    console.error("CommentReport event is missing subreddit or comment data");
    return;
  }

  const contentPreview = comment.body ?? "";
  const title = previewText(contentPreview, 100) || "Reported Comment";

  await sendModQueueEmbed(subredditName, {
    title,
    url: redditPermalinkUrl(comment.permalink),
    username: comment.author || "Unknown",
    contentType: "comment",
    reason: event.reason,
    contentPreview,
    isAutomod: false,
  });
}

export async function sendModQueueAlertFromAutomodPost(
  event: AutomoderatorFilterPost
): Promise<void> {
  const subredditName = event.subreddit?.name ?? "";
  const post = event.post;

  if (!subredditName || !post) {
    console.error("AutomoderatorFilterPost event is missing subreddit or post data");
    return;
  }

  const contentPreview = post.selftext || post.title || "";
  const title = post.title || previewText(contentPreview, 100);

  let username = "Unknown";
  try {
    const livePost = await reddit.getPostById(toPostId(post.id));
    username = livePost.authorName ?? event.author ?? "Unknown";
  } catch {
    username = event.author ?? "Unknown";
  }

  await sendModQueueEmbed(subredditName, {
    title,
    url: redditPermalinkUrl(post.permalink),
    username,
    contentType: "post",
    reason: event.reason,
    contentPreview,
    isAutomod: true,
  });
}

export async function sendModQueueAlertFromAutomodComment(
  event: AutomoderatorFilterComment
): Promise<void> {
  const subredditName = event.subreddit?.name ?? "";
  const comment = event.comment;

  if (!subredditName || !comment) {
    console.error("AutomoderatorFilterComment event is missing subreddit or comment data");
    return;
  }

  const contentPreview = comment.body ?? "";
  const title = previewText(contentPreview, 100) || "AutoMod Filtered Comment";

  // comment.author and event.author may be Reddit user IDs (t2_xxx) rather
  // than usernames; prefer comment.author if it doesn't look like an ID
  const rawAuthor = comment.author || event.author || "Unknown";
  const username = /^t2_[a-z0-9]+$/i.test(rawAuthor) ? "Unknown" : rawAuthor;

  await sendModQueueEmbed(subredditName, {
    title,
    url: redditPermalinkUrl(comment.permalink),
    username,
    contentType: "comment",
    reason: event.reason,
    contentPreview,
    isAutomod: true,
  });
}

export async function sendNewPostAlert(event: PostSubmit): Promise<void> {
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

  const postId = toPostId(post.id);
  await markPostAlertPending(postId);

  try {
    await sleep(10_000);

    const livePost = await reddit.getPostById(postId);
    if (livePost.removed) {
      console.log(
        `Post ${post.id} was removed or filtered before the new-post alert could be sent. Skipping Discord notification.`
      );
      return;
    }

    const webhook = await getWebhookUrl(subredditName, "newposts");
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

    const color = flairText ? SPECTRUM_BLUE : POST_WHITE;
    await sendTicketAlert({
      webhook,
      source: "newposts",
      subredditName,
      embed: {
        title: truncateTitle(post.title),
        url: postUrl,
        author: {
          name: username,
          url: redditProfileUrl(username),
        },
        fields,
        color,
        timestamp: new Date().toISOString(),
      },
      baseColor: color,
      redditKey: postId,
      redditKeyType: "post",
      threadName: post.title,
    });
  } finally {
    await clearPostAlertPending(postId);
  }
}

export async function sendCommentFollowUpToTicket(
  event: CommentSubmit | CommentCreate
): Promise<void> {
  const subredditName = event.subreddit?.name ?? "";
  if (!subredditName || !isMonitoredSubreddit(subredditName)) {
    return;
  }

  const commentId = event.comment?.id;
  if (commentId && !(await markCommentFollowUpHandled(commentId))) {
    console.log(`Skipping duplicate comment follow-up for ${commentId}.`);
    return;
  }

  const postId = toPostId(event.comment?.postId ?? event.post?.id ?? "");
  const authorName = event.author?.name ?? event.comment?.author ?? "Unknown";
  const body = event.comment?.body?.trim() ?? "";
  const hasMedia =
    Boolean(event.comment?.hasMedia) || (event.comment?.mediaUrls?.length ?? 0) > 0;
  const preview = body || (hasMedia ? "[Media comment]" : "");

  if (!postId || !preview) {
    console.log(
      `Skipping comment follow-up for post "${postId || "unknown"}": missing post id or comment content.`
    );
    return;
  }

  const activeTicket = await resolvePostTicketForFollowUp(postId);
  if (!activeTicket) {
    console.log(
      `No active Discord ticket for post ${postId}. Only posts that received a new alert after the upgrade can receive comment follow-ups in-thread.`
    );
    return;
  }

  let postUrl: string | undefined;
  try {
    const post = await reddit.getPostById(postId);
    postUrl = redditPermalinkUrl(post.permalink);
  } catch (error) {
    console.error("Unable to resolve post URL for comment follow-up:", getErrorMessage(error));
  }

  const handled = await postTicketFollowUp(activeTicket, {
    title: "New comment",
    previewFieldName: "Post Preview",
    preview,
    authorName,
    url: postUrl,
    color: POST_WHITE,
    pingAssignee: true,
  });

  if (!handled) {
    console.error(
      `Failed to post comment follow-up for ${postId}. Confirm the Discord Bot Token is set and the bot can send messages in the alert channel.`
    );
  }
}

export async function sendPostUpdateFollowUpToTicket(event: PostUpdate): Promise<void> {
  const subredditName = event.subreddit?.name ?? "";
  const post = event.post;
  if (!subredditName || !post || !isMonitoredSubreddit(subredditName)) {
    return;
  }

  if (!post.isSelf) {
    return;
  }

  const postId = toPostId(post.id);
  const nextBody = post.selftext?.trim() ?? "";
  const previousBody = event.previousBody?.trim() ?? "";
  if (!nextBody || nextBody === previousBody) {
    return;
  }

  const activeTicket = await resolvePostTicketForFollowUp(postId);
  if (!activeTicket) {
    console.log(`No active Discord ticket for updated post ${postId}.`);
    return;
  }

  const authorName = event.author?.name ?? "Unknown";
  const postUrl = redditPermalinkUrl(post.permalink);

  await postTicketFollowUp(activeTicket, {
    title: "Post updated",
    previewFieldName: "Post Preview",
    preview: nextBody,
    authorName,
    url: postUrl,
    color: POST_WHITE,
    pingAssignee: true,
  });
}

export async function trackModMailForReport(event: ModMail): Promise<void> {
  const subredditName =
    event.conversationSubreddit?.name ?? event.destinationSubreddit?.name ?? "";
  if (!subredditName) {
    return;
  }
  const secondary = await getSecondarySubredditName();
  const subreddit = getMonitoredSubredditKey(subredditName, secondary)!;

  const conversationId = event.conversationId;
  if (!conversationId) {
    return;
  }

  const store = await getDailyReportStore();
  const metrics = getMetrics(store, subreddit);
  const participatingAs = event.messageAuthorType ?? "";
  const isModeratorMessage = participatingAs === "moderator";
  const isUserMessage = participatingAs === "participant_user";
  const now = Date.now();

  if (isUserMessage) {
    metrics.modmailReceived += 1;

    const existing = store.modmailConversations[conversationId];
    if (existing) {
      existing.lastUserMessageAt = now;
    } else {
      store.modmailConversations[conversationId] = {
        subreddit,
        firstUserMessageAt: now,
        lastUserMessageAt: now,
        lastModReplyAt: null,
        modReplied: false,
        resolved: false,
      };
    }
  }

  if (isModeratorMessage) {
    const conversation = store.modmailConversations[conversationId];
    if (conversation && !conversation.modReplied) {
      const responseMs = now - conversation.lastUserMessageAt;
      if (responseMs >= 0) {
        metrics.modmailResponseTimeTotalMs += responseMs;
        metrics.modmailResponseTimeSamples += 1;
      }
      conversation.modReplied = true;
      conversation.lastModReplyAt = now;
    } else if (conversation) {
      conversation.lastModReplyAt = now;
    }
  }

  const conversationState = (event.conversationState ?? "").toLowerCase();
  if (conversationState === "archived") {
    const conversation = store.modmailConversations[conversationId];
    if (conversation && !conversation.resolved) {
      conversation.resolved = true;
      metrics.modmailResolved += 1;
    }
  }

  await saveDailyReportStore(store);
}

export async function trackModQueueForReport(
  event:
    | ({ type: "PostReport" } & PostReport)
    | ({ type: "CommentReport" } & CommentReport)
    | ({ type: "AutomoderatorFilterPost" } & AutomoderatorFilterPost)
    | ({ type: "AutomoderatorFilterComment" } & AutomoderatorFilterComment)
): Promise<void> {
  const subredditName = event.subreddit?.name ?? "";
  if (!subredditName) {
    return;
  }
  const secondary = await getSecondarySubredditName();
  const subreddit = getMonitoredSubredditKey(subredditName, secondary)!;

  const store = await getDailyReportStore();
  getMetrics(store, subreddit).modQueueFlagged += 1;
  await saveDailyReportStore(store);
}

export async function trackPostSubmitForReport(event: PostSubmit): Promise<void> {
  const subredditName = event.subreddit?.name ?? "";
  const post = event.post;
  if (!subredditName || !post) {
    return;
  }
  const secondary = await getSecondarySubredditName();
  const subreddit = getMonitoredSubredditKey(subredditName, secondary)!;

  const store = await getDailyReportStore();
  const metrics = getMetrics(store, subreddit);
  const postId = toPostId(post.id);

  metrics.newPostsSubmitted += 1;
  metrics.postsWithoutModResponse += 1;

  let isLive = true;
  try {
    const livePost = await reddit.getPostById(postId);
    isLive = !livePost.removed;
  } catch (error) {
    console.error("Error checking post status for report tracking:", getErrorMessage(error));
  }

  if (isLive) {
    metrics.postsLive += 1;
  } else {
    metrics.postsRemoved += 1;
    metrics.postsWithoutModResponse -= 1;
  }

  store.trackedPosts[postId] = {
    subreddit,
    submittedAt: Date.now(),
    hasModResponse: false,
    isLive,
  };

  await saveDailyReportStore(store);
}

export async function trackCommentSubmitForReport(event: CommentSubmit): Promise<void> {
  const subredditName = event.subreddit?.name ?? "";
  const postId = toPostId(event.comment?.postId ?? event.post?.id ?? "");
  const authorName = event.author?.name ?? event.comment?.author ?? "";

  if (!subredditName || !postId || !authorName) {
    return;
  }

  const author = await reddit.getUserByUsername(authorName);
  if (!author) {
    return;
  }

  const modPermissions = await author.getModPermissionsForSubreddit(
    normalizeSubredditName(subredditName)
  );
  if (modPermissions.length === 0) {
    return;
  }

  const store = await getDailyReportStore();
  const trackedPost = store.trackedPosts[postId];
  if (!trackedPost || trackedPost.hasModResponse) {
    return;
  }

  const metrics = getMetrics(store, trackedPost.subreddit);
  const responseMs = Date.now() - trackedPost.submittedAt;
  if (responseMs >= 0) {
    metrics.postResponseTimeTotalMs += responseMs;
    metrics.postResponseTimeSamples += 1;
  }

  trackedPost.hasModResponse = true;
  metrics.postsWithModResponse += 1;
  metrics.postsWithoutModResponse = Math.max(0, metrics.postsWithoutModResponse - 1);

  await saveDailyReportStore(store);
}

export async function trackModActionForReport(event: ModAction): Promise<void> {
  const subredditName = event.subreddit?.name ?? "";
  const action = (event.action ?? "").toLowerCase();

  if (!subredditName || !action) {
    return;
  }
  const secondary = await getSecondarySubredditName();
  const subreddit = getMonitoredSubredditKey(subredditName, secondary)!;

  const store = await getDailyReportStore();
  const metrics = getMetrics(store, subreddit);

  if (MOD_QUEUE_APPROVE_ACTIONS.has(action)) {
    metrics.modQueueApproved += 1;
  }

  if (MOD_QUEUE_REMOVE_ACTIONS.has(action)) {
    metrics.modQueueRemoved += 1;
  }

  const postId = event.targetPost?.id ? toPostId(event.targetPost.id) : null;
  if (postId && store.trackedPosts[postId] && MOD_QUEUE_REMOVE_ACTIONS.has(action)) {
    const trackedPost = store.trackedPosts[postId];
    if (trackedPost.isLive) {
      trackedPost.isLive = false;
      metrics.postsLive = Math.max(0, metrics.postsLive - 1);
      metrics.postsRemoved += 1;
    }
  }

  await saveDailyReportStore(store);
}
