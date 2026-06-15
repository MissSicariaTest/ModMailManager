export const DISCORD_WEBHOOK_HOSTS = [
  "canary.discord.com",
  "ptb.discord.com",
  "discord.com",
  "canary.discordapp.com",
  "ptb.discordapp.com",
  "discordapp.com",
] as const;

export const SPECTRUM_BLUE = 0x005fff;
export const PRIVATE_NOTE_GREEN = 0x00cc66;
export const REPORTED_ORANGE = 0xff4500;
export const AUTOMOD_YELLOW = 0xffcc00;
export const POST_WHITE = 0xffffff;

export const PREVIEW_LENGTH = 300;
export const TITLE_LENGTH = 256;
export const FIELD_LENGTH = 1024;

export const REPORT_TIMEZONE = "America/New_York";
export const REPORT_HOUR = 8;

export const DAILY_REPORT_REDIS_KEY = "dailyReport:data";
export const DAILY_REPORT_SENT_REDIS_KEY = "dailyReport:lastSentDate";
export const TICKET_REDIS_PREFIX = "ticket:";
export const OPEN_TICKETS_REDIS_KEY = "tickets:open";

export const MONITORED_SUBREDDITS = ["spectrum", "spectrum_official"] as const;
export const PLAYTEST_SUBREDDIT = "spectrum_modmail_dev";

export const MOD_QUEUE_APPROVE_ACTIONS = new Set(["approvelink", "approvecomment"]);
export const MOD_QUEUE_REMOVE_ACTIONS = new Set([
  "removelink",
  "removecomment",
  "spamlink",
  "spamcomment",
]);

export const TICKET_ACTIONS = [
  "claim",
  "close",
  "reopen",
  "resolved",
  "unresolved",
  "reassign",
] as const;

export type TicketAction = (typeof TICKET_ACTIONS)[number];

export const BUTTON_LABELS: Record<TicketAction, string> = {
  claim: "Claim",
  close: "Close",
  reopen: "Reopen",
  resolved: "Resolved",
  unresolved: "Unresolved",
  reassign: "Reassign",
};

export const ACTION_FIELD_LABELS: Record<TicketAction, string> = {
  claim: "Claimed",
  close: "Closed",
  reopen: "Reopened",
  resolved: "Resolved",
  unresolved: "Unresolved",
  reassign: "Reassigned",
};

export const STATUS_COLORS: Record<string, number> = {
  open: SPECTRUM_BLUE,
  claimed: 0x3498db,
  closed: 0x95a5a6,
  resolved: 0x2ecc71,
  unresolved: 0xe74c3c,
};
