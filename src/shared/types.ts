import type { MonitoredSubreddit } from "./subreddit.js";

export type WebhookCategory = "modmail" | "modqueue" | "newposts";
export type TicketSource = WebhookCategory;
export type TicketStatus = "open" | "claimed" | "closed" | "resolved" | "unresolved";

export type DiscordEmbedField = {
  name: string;
  value: string;
  inline?: boolean;
};

export type DiscordEmbed = {
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
  footer?: {
    text: string;
  };
};

export type DiscordButton = {
  type: 2;
  style: 1 | 2 | 3 | 4;
  label: string;
  custom_id: string;
  disabled?: boolean;
};

export type DiscordActionRow = {
  type: 1;
  components: DiscordButton[];
};

export type DiscordWebhookPayload = {
  content?: string;
  embeds: DiscordEmbed[];
  components?: DiscordActionRow[];
};

export type DiscordWebhookMessage = {
  id: string;
  channel_id: string;
};

export type TicketActionLog = {
  action: string;
  discordUserId: string;
  discordUsername: string;
  timestamp: string;
  details?: string;
};

export type TicketRecord = {
  id: string;
  source: TicketSource;
  subreddit: MonitoredSubreddit;
  status: TicketStatus;
  assignedTo?: string;
  assignedToId?: string;
  webhookId: string;
  webhookToken: string;
  messageId: string;
  channelId: string;
  baseEmbed: DiscordEmbed;
  baseColor: number;
  content?: string;
  actionLog: TicketActionLog[];
  createdAt: string;
  updatedAt: string;
};

export type SubredditMetrics = {
  modmailReceived: number;
  newPostsSubmitted: number;
  modQueueFlagged: number;
  postsWithModResponse: number;
  postsWithoutModResponse: number;
  modmailResponseTimeTotalMs: number;
  modmailResponseTimeSamples: number;
  postResponseTimeTotalMs: number;
  postResponseTimeSamples: number;
  modmailResolved: number;
  modmailUnresolved: number;
  modmailAbandoned: number;
  modQueueApproved: number;
  modQueueRemoved: number;
  postsLive: number;
  postsRemoved: number;
  ticketsClaimed: number;
  ticketsClosed: number;
  ticketsResolved: number;
  ticketsUnresolved: number;
  ticketsReassigned: number;
  ticketsReopened: number;
};

export type TicketHandlerStats = Record<
  string,
  {
    claimed: number;
    closed: number;
    resolved: number;
    unresolved: number;
    reassigned: number;
    reopened: number;
  }
>;

export type ModmailConversationTracking = {
  subreddit: MonitoredSubreddit;
  firstUserMessageAt: number;
  lastUserMessageAt: number;
  lastModReplyAt: number | null;
  modReplied: boolean;
  resolved: boolean;
};

export type PostTracking = {
  subreddit: MonitoredSubreddit;
  submittedAt: number;
  hasModResponse: boolean;
  isLive: boolean;
};

export type DailyReportStore = {
  periodStartedAt: string;
  subreddits: Record<MonitoredSubreddit, SubredditMetrics>;
  modmailConversations: Record<string, ModmailConversationTracking>;
  trackedPosts: Record<string, PostTracking>;
  ticketHandlers: Record<MonitoredSubreddit, TicketHandlerStats>;
};

export type ParsedWebhook = {
  id: string;
  token: string;
  url: string;
};

export type DiscordInteraction = {
  type: number;
  id: string;
  token: string;
  member?: {
    user?: {
      id: string;
      username: string;
      global_name?: string;
    };
  };
  user?: {
    id: string;
    username: string;
    global_name?: string;
  };
  data?: {
    custom_id?: string;
    components?: Array<{
      components?: Array<{
        value?: string;
      }>;
    }>;
  };
  message?: {
    id: string;
    embeds?: DiscordEmbed[];
    components?: DiscordActionRow[];
  };
};
