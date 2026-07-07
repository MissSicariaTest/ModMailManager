/**
 * Cloudflare Worker: Discord button interactions for ModMailManager.
 * Discord POSTs button clicks here (public). Devvit POSTs new tickets here on register.
 */

import { verifyKey } from "discord-interactions";

export interface Env {
  TICKETS: KVNamespace;
  REPORT: KVNamespace;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN?: string;
  WORKER_SECRET: string;
  CLOSED_TICKETS_WEBHOOK_SPECTRUM?: string;
  CLOSED_TICKETS_WEBHOOK_SPECTRUM_OFFICIAL?: string;
  REPORTING_WEBHOOK?: string;
  REPORTING_WEBHOOK_SPECTRUM?: string;
  REPORTING_WEBHOOK_SPECTRUM_OFFICIAL?: string;
}

type TicketAction =
  | "claim"
  | "unclaim"
  | "close"
  | "reopen"
  | "resolved"
  | "unresolved"
  | "reassign";

type TicketStatus = "open" | "claimed" | "closed" | "resolved" | "unresolved";

type TicketActionLog = {
  action: string;
  discordUserId: string;
  discordUsername: string;
  timestamp: string;
  details?: string;
};

type TicketRecord = {
  id: string;
  source: string;
  subreddit: string;
  status: TicketStatus;
  assignedTo?: string;
  assignedToId?: string;
  webhookId: string;
  webhookToken: string;
  messageId: string;
  channelId: string;
  threadId?: string;
  redditKey?: string;
  redditKeyType?: "modmail" | "post";
  archived?: boolean;
  activeWebhookId?: string;
  activeWebhookToken?: string;
  activeChannelId?: string;
  activeMessageId?: string;
  closedWebhookId?: string;
  closedWebhookToken?: string;
  baseEmbed: Record<string, unknown>;
  baseColor: number;
  content?: string;
  actionLog: TicketActionLog[];
  createdAt: string;
  updatedAt: string;
};

const ARCHIVE_ACTIONS = new Set<TicketAction>(["close", "resolved", "unresolved"]);

const TICKET_ACTIONS: TicketAction[] = [
  "claim",
  "unclaim",
  "close",
  "reopen",
  "resolved",
  "unresolved",
  "reassign",
];

const BUTTON_LABELS: Record<TicketAction, string> = {
  claim: "Claim",
  unclaim: "Unclaim",
  close: "Close",
  reopen: "Reopen",
  resolved: "Resolved",
  unresolved: "Unresolved",
  reassign: "Reassign",
};

const ACTION_FIELD_LABELS: Record<TicketAction, string> = {
  claim: "Claimed",
  unclaim: "Unclaimed",
  close: "Closed",
  reopen: "Reopened",
  resolved: "Resolved",
  unresolved: "Unresolved",
  reassign: "Reassigned",
};

const STATUS_COLORS: Record<string, number> = {
  open: 0x005fff,
  claimed: 0x3498db,
  closed: 0x95a5a6,
  resolved: 0x2ecc71,
  unresolved: 0xe74c3c,
};

const FIELD_LENGTH = 1024;
const OPEN_TICKETS_KEY = "tickets:open";
const CLOSED_WEBHOOKS_CONFIG_KEY = "config:closedWebhooks";

type ClosedWebhookCredentials = {
  webhookId: string;
  webhookToken: string;
};

type ClosedWebhookConfig = {
  spectrum?: ClosedWebhookCredentials | null;
  spectrum_official?: ClosedWebhookCredentials | null;
  syncedAt?: string;
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/tickets/register") {
      return registerTicket(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/config/closed-webhooks") {
      return syncClosedWebhooksConfig(request, env);
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/tickets/")) {
      const ticketId = decodeURIComponent(url.pathname.replace("/api/tickets/", ""));
      if (ticketId && ticketId !== "register") {
        return getTicketById(request, env, ticketId);
      }
    }

    if (request.method === "GET" && url.pathname === "/api/report/snapshot") {
      return getReportSnapshot(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/report/reset") {
      return resetReportSnapshot(request, env);
    }

    if (request.method === "POST" && (url.pathname === "/" || url.pathname === "/discord/interactions")) {
      return handleDiscordInteraction(request, env, ctx);
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return getHealthStatusWithSync(env);
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/docs")) {
      return new Response(API_DOCUMENTATION, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(maybeSendDailyTicketReport(env));
  },
};

const REPORT_TIMEZONE = "America/New_York";
const REPORT_HOUR = 8;
const REPORT_SENT_KEY = "report:lastSentDate";

function getLocalHour(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).format(date);
  return Number.parseInt(hour, 10);
}

function getDateKeyInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function subredditReportLabel(subreddit: string): string {
  return subreddit === "spectrum_official" ? "Secondary Subreddit" : "Primary Subreddit";
}

function formatHandlerLines(handlers: Record<string, Record<string, number>>): string {
  const entries = Object.entries(handlers);
  if (entries.length === 0) {
    return "No Discord ticket actions recorded.";
  }
  return entries
    .map(([username, stats]) => {
      const parts = Object.entries(stats).map(([action, count]) => `${count} ${action}`);
      return `${username}: ${parts.join(", ") || "no actions"}`;
    })
    .join("\n")
    .slice(0, 1024);
}

function resolveReportingWebhook(env: Env, subreddit: string): string | null {
  const specific =
    subreddit === "spectrum_official"
      ? env.REPORTING_WEBHOOK_SPECTRUM_OFFICIAL
      : env.REPORTING_WEBHOOK_SPECTRUM;
  return specific?.trim() || env.REPORTING_WEBHOOK?.trim() || null;
}

function buildSubredditTicketFields(
  metrics: ReportSnapshot["subreddits"][string]
): Array<{ name: string; value: string; inline?: boolean }> {
  return [
    { name: "Tickets Claimed", value: String(metrics.ticketsClaimed), inline: true },
    { name: "Tickets Closed", value: String(metrics.ticketsClosed), inline: true },
    { name: "Tickets Resolved", value: String(metrics.ticketsResolved), inline: true },
    { name: "Tickets Unresolved", value: String(metrics.ticketsUnresolved), inline: true },
    { name: "Tickets Reassigned", value: String(metrics.ticketsReassigned), inline: true },
    { name: "Tickets Reopened", value: String(metrics.ticketsReopened), inline: true },
    { name: "Open Unclaimed Tickets", value: String(metrics.openUnclaimed), inline: true },
    { name: "Discord Handlers", value: formatHandlerLines(metrics.handlers), inline: false },
  ];
}

async function maybeSendDailyTicketReport(env: Env): Promise<void> {
  const anyWebhook =
    env.REPORTING_WEBHOOK?.trim() ||
    env.REPORTING_WEBHOOK_SPECTRUM?.trim() ||
    env.REPORTING_WEBHOOK_SPECTRUM_OFFICIAL?.trim();
  if (!anyWebhook) {
    return;
  }

  const now = new Date();
  if (getLocalHour(now, REPORT_TIMEZONE) !== REPORT_HOUR) {
    return;
  }

  const todayKey = getDateKeyInTimezone(now, REPORT_TIMEZONE);
  const lastSent = await env.REPORT.get(REPORT_SENT_KEY);
  if (lastSent === todayKey) {
    return;
  }

  const raw = (await env.REPORT.get("snapshot")) ?? JSON.stringify(createEmptySnapshot());
  const snapshot = JSON.parse(raw) as ReportSnapshot;

  const generatedAt = new Intl.DateTimeFormat("en-US", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(now);

  let anySent = false;

  for (const [subreddit, metrics] of Object.entries(snapshot.subreddits)) {
    const webhook = resolveReportingWebhook(env, subreddit);
    if (!webhook) {
      continue;
    }

    const label = subredditReportLabel(subreddit);
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: `Daily Ticket Report — ${label}`,
            description: "Discord ticket button activity recorded since the previous report.",
            fields: buildSubredditTicketFields(metrics),
            color: 0x005fff,
            footer: { text: `Report generated ${generatedAt}` },
          },
        ],
      }),
    });

    if (response.ok) {
      anySent = true;
    } else {
      console.error(
        `Daily ticket report webhook failed for ${subreddit}:`,
        response.status,
        await response.text().catch(() => "")
      );
    }
  }

  if (anySent) {
    await env.REPORT.put(REPORT_SENT_KEY, todayKey);
    await env.REPORT.put("snapshot", JSON.stringify(createEmptySnapshot()));
  }
}

const API_DOCUMENTATION = `ModMailManager — Discord Interactions Worker
=============================================

This Cloudflare Worker is the Discord-facing companion for the
ModMailManager Reddit app
(https://developers.reddit.com/apps/modmailmanager).
Source code: https://github.com/MissSicariaTest/ModMailManager

The Reddit app does NOT call this Worker. All traffic here is between
Discord and this Worker.

WHY THIS SERVICE EXISTS
-----------------------
Devvit apps cannot receive inbound HTTP requests from external services.
Discord ticket buttons (Claim / Close / Resolved / Unresolved / Reassign /
Reopen) require a publicly reachable Interactions Endpoint that verifies
Discord's Ed25519 request signatures and responds within 3 seconds.
This Worker fills that role.

ENDPOINTS
---------

POST /  (and /discord/interactions)
  Discord Interactions Endpoint. Receives button clicks and modal
  submissions directly from Discord, verified via Ed25519 signature.
  Updates ticket embeds, moves closed tickets to the archive channel.

GET /api/health
  Public, unauthenticated configuration health check (booleans only).

GET / and /docs
  This documentation.

Authenticated /api/* endpoints (Bearer WORKER_SECRET) exist for
operator diagnostics (ticket lookup, report snapshot) but are not used
by the Reddit app.

SCHEDULED JOBS
--------------
A Cloudflare cron trigger posts a Daily Ticket Report (aggregated
button-action counts per moderator) to the Discord webhook configured
in the REPORTING_WEBHOOK secret, at ~8:05 AM US Eastern.

DATA HANDLING
-------------
- Stored in Cloudflare KV: ticket state records and aggregated action
  counters. Counters reset after each daily report cycle.
- Data sources: Discord button interactions and embed content already
  visible in the moderators' own Discord channels.
- Privacy policy:
  https://github.com/MissSicariaTest/ModMailManager/blob/main/PRIVACY.md
`;

function authorizeWorker(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization") ?? "";
  const secret = env.WORKER_SECRET?.trim() ?? "";
  return auth === `Bearer ${secret}`;
}

function isSecretConfigured(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function getHealthStatus(env: Env): Record<string, unknown> {
  const primaryWebhookSet = isSecretConfigured(env.CLOSED_TICKETS_WEBHOOK_SPECTRUM);
  const primaryWebhookValid = primaryWebhookSet
    ? parseWebhookUrl(env.CLOSED_TICKETS_WEBHOOK_SPECTRUM) !== null
    : false;
  const secondaryWebhookSet = isSecretConfigured(env.CLOSED_TICKETS_WEBHOOK_SPECTRUM_OFFICIAL);
  const secondaryWebhookValid = secondaryWebhookSet
    ? parseWebhookUrl(env.CLOSED_TICKETS_WEBHOOK_SPECTRUM_OFFICIAL) !== null
    : false;

  return {
    ok: isSecretConfigured(env.DISCORD_PUBLIC_KEY) && isSecretConfigured(env.WORKER_SECRET),
    secrets: {
      DISCORD_PUBLIC_KEY: isSecretConfigured(env.DISCORD_PUBLIC_KEY),
      WORKER_SECRET: isSecretConfigured(env.WORKER_SECRET),
      DISCORD_BOT_TOKEN: isSecretConfigured(env.DISCORD_BOT_TOKEN),
      CLOSED_TICKETS_WEBHOOK_SPECTRUM: primaryWebhookSet,
      CLOSED_TICKETS_WEBHOOK_SPECTRUM_valid: primaryWebhookValid,
      CLOSED_TICKETS_WEBHOOK_SPECTRUM_OFFICIAL: secondaryWebhookSet,
      CLOSED_TICKETS_WEBHOOK_SPECTRUM_OFFICIAL_valid: secondaryWebhookValid,
    },
    note: "CLOSED_TICKETS_WEBHOOK_SPECTRUM_valid must be true for closed-ticket archiving to work. If set but not valid, the URL format is wrong — it must be a full Discord webhook URL containing /api/webhooks/.",
  };
}

async function syncClosedWebhooksConfig(request: Request, env: Env): Promise<Response> {
  if (!authorizeWorker(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const incoming = (await request.json()) as ClosedWebhookConfig;
  const existing = (await getClosedWebhookConfig(env)) ?? {};
  const merged: ClosedWebhookConfig = {
    spectrum: incoming.spectrum ?? existing.spectrum ?? null,
    spectrum_official: incoming.spectrum_official ?? existing.spectrum_official ?? null,
    syncedAt: new Date().toISOString(),
  };

  await env.TICKETS.put(CLOSED_WEBHOOKS_CONFIG_KEY, JSON.stringify(merged));
  return Response.json({
    ok: true,
    closedWebhooksFromReddit: {
      spectrum: Boolean(merged.spectrum?.webhookId),
      spectrum_official: Boolean(merged.spectrum_official?.webhookId),
    },
    syncedAt: merged.syncedAt,
  });
}

async function getTicketById(request: Request, env: Env, ticketId: string): Promise<Response> {
  if (!authorizeWorker(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const ticket = await getTicket(env, ticketId);
  if (!ticket) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }

  return Response.json(ticket);
}

async function registerTicket(request: Request, env: Env): Promise<Response> {
  if (!authorizeWorker(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const ticket = (await request.json()) as TicketRecord;
  if (!ticket?.id) {
    return Response.json({ error: "Missing ticket id" }, { status: 400 });
  }

  await saveTicket(env, ticket);
  await mergeClosedWebhookFromTicket(env, ticket);
  return Response.json({ ok: true, id: ticket.id });
}

async function getReportSnapshot(request: Request, env: Env): Promise<Response> {
  if (!authorizeWorker(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const raw = await env.REPORT.get("snapshot");
  if (!raw) {
    return Response.json(createEmptySnapshot());
  }
  return new Response(raw, {
    headers: { "Content-Type": "application/json" },
  });
}

async function resetReportSnapshot(request: Request, env: Env): Promise<Response> {
  if (!authorizeWorker(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  await env.REPORT.put("snapshot", JSON.stringify(createEmptySnapshot()));
  return Response.json({ ok: true });
}

async function handleDiscordInteraction(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const signature = request.headers.get("X-Signature-Ed25519") ?? "";
  const timestamp = request.headers.get("X-Signature-Timestamp") ?? "";
  const rawBody = await request.text();
  const publicKey = env.DISCORD_PUBLIC_KEY?.trim();

  if (!publicKey) {
    console.error("DISCORD_PUBLIC_KEY is not configured on the worker.");
    return interactionResponse(
      ephemeral(
        "Button actions are not configured yet. In Cloudflare, add a worker secret named DISCORD_PUBLIC_KEY using the Public Key from Discord Developer Portal → General Information."
      )
    );
  }

  const isValid = await verifyKey(rawBody, signature, timestamp, publicKey);
  if (!isValid) {
    console.error("Discord interaction signature verification failed.");
    return new Response("Invalid signature", { status: 401 });
  }

  try {
    const interaction = JSON.parse(rawBody) as DiscordInteraction;

    if (interaction.type === 1) {
      return interactionResponse({ type: 1 });
    }

    if (interaction.type === 3) {
      return handleButton(interaction, env, ctx);
    }

    if (interaction.type === 5) {
      return handleModal(interaction, env, ctx);
    }

    return interactionResponse(ephemeral("Unsupported interaction type."));
  } catch (error) {
    console.error("Discord interaction handler error:", error);
    return interactionResponse(ephemeral("Something went wrong handling this button."));
  }
}

type DiscordEmbedField = {
  name: string;
  value: string;
  inline?: boolean;
};

type DiscordEmbedPayload = {
  title?: string;
  url?: string;
  description?: string;
  author?: { name: string; url?: string };
  fields?: DiscordEmbedField[];
  color?: number;
  timestamp?: string;
  footer?: { text: string };
};

type DiscordInteractionMessage = {
  id: string;
  channel_id: string;
  embeds?: DiscordEmbedPayload[];
};

type DiscordInteraction = {
  type: number;
  id: string;
  token: string;
  application_id: string;
  member?: { user?: { id: string; username: string; global_name?: string } };
  user?: { id: string; username: string; global_name?: string };
  message?: DiscordInteractionMessage;
  data?: {
    custom_id?: string;
    components?: Array<{ components?: Array<{ custom_id?: string; value?: string }> }>;
  };
};

async function handleButton(
  interaction: DiscordInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const customId = interaction.data?.custom_id;
  if (!customId) {
    return interactionResponse(ephemeral("Missing button id."));
  }

  const parsed = parseTicketCustomId(customId);
  if (!parsed) {
    return interactionResponse(ephemeral("Unknown button."));
  }

  const actor = getInteractionUser(interaction);
  if (!actor) {
    return interactionResponse(ephemeral("Unable to identify Discord user."));
  }

  const ticket = await resolveTicketForInteraction(env, interaction, parsed.ticketId);
  if (!ticket) {
    return interactionResponse(
      ephemeral("Unable to load this Discord alert. Try clicking the button again.")
    );
  }

  if (parsed.action === "reassign") {
    const err = isTicketActionAllowed(ticket, parsed.action);
    if (err) {
      return interactionResponse(ephemeral(err));
    }
    return interactionResponse(buildReassignModal(parsed.ticketId));
  }

  const err = isTicketActionAllowed(ticket, parsed.action);
  if (err) {
    return interactionResponse(ephemeral(err));
  }

  const updated = await applyTicketAction(env, ticket, parsed.action, actor);
  ctx.waitUntil(
    trackAction(env, updated.subreddit, parsed.action, actor.username).catch((error) => {
      console.error("Failed to track ticket action:", error);
    })
  );

  return finalizeTicketInteraction(env, ticket, updated, parsed.action, interaction, ctx);
}

async function handleModal(
  interaction: DiscordInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const customId = interaction.data?.custom_id;
  if (!customId?.startsWith("reassign:")) {
    return interactionResponse(ephemeral("Unknown modal."));
  }

  const ticketId = customId.replace("reassign:", "");
  const { assigneeName, assigneeDiscordId } = parseReassignModalValues(interaction);

  if (!assigneeName) {
    return interactionResponse(ephemeral("Please enter a team member name."));
  }

  const actor = getInteractionUser(interaction);
  if (!actor) {
    return interactionResponse(ephemeral("Unable to identify Discord user."));
  }

  const ticket = await resolveTicketForInteraction(env, interaction, ticketId);
  if (!ticket) {
    return interactionResponse(ephemeral("Unable to load this Discord alert."));
  }

  const err = isTicketActionAllowed(ticket, "reassign");
  if (err) {
    return interactionResponse(ephemeral(err));
  }

  const updated = await applyTicketAction(
    env,
    ticket,
    "reassign",
    actor,
    assigneeName,
    assigneeDiscordId
  );
  ctx.waitUntil(
    trackAction(env, updated.subreddit, "reassign", actor.username).catch((error) => {
      console.error("Failed to track ticket action:", error);
    })
  );
  return finalizeTicketInteraction(env, ticket, updated, "reassign", interaction, ctx, assigneeDiscordId);
}

async function saveTicket(env: Env, ticket: TicketRecord): Promise<void> {
  await env.TICKETS.put(`ticket:${ticket.id}`, JSON.stringify(ticket));

  if (ticket.redditKey && ticket.redditKeyType) {
    await env.TICKETS.put(`reddit:${ticket.redditKeyType}:${ticket.redditKey}`, ticket.id);
  }

  const openRaw = (await env.TICKETS.get(OPEN_TICKETS_KEY)) ?? "{}";
  const openMap = JSON.parse(openRaw) as Record<string, string>;

  if (ticket.status === "open" || ticket.status === "claimed") {
    openMap[ticket.id] = ticket.status;
  } else {
    delete openMap[ticket.id];
  }

  await env.TICKETS.put(OPEN_TICKETS_KEY, JSON.stringify(openMap));
}

async function getTicket(env: Env, ticketId: string): Promise<TicketRecord | null> {
  const raw = await env.TICKETS.get(`ticket:${ticketId}`);
  return raw ? (JSON.parse(raw) as TicketRecord) : null;
}

async function getTicketWithRetry(env: Env, ticketId: string): Promise<TicketRecord | null> {
  let ticket = await getTicket(env, ticketId);
  if (ticket) {
    return ticket;
  }

  await new Promise((resolve) => setTimeout(resolve, 400));
  ticket = await getTicket(env, ticketId);
  return ticket;
}

function parseStatusLabel(label: string): TicketStatus {
  const normalized = label.trim().toLowerCase();
  if (normalized === "claimed") return "claimed";
  if (normalized === "closed") return "closed";
  if (normalized === "resolved") return "resolved";
  if (normalized === "unresolved") return "unresolved";
  return "open";
}

function parseSubredditGroup(subredditValue: string): string {
  const normalized = subredditValue.replace(/^r\//i, "").trim().toLowerCase();
  if (normalized === "spectrum_official") {
    return "spectrum_official";
  }
  return "spectrum";
}

function parseActionLogFromFields(fields: DiscordEmbedField[]): TicketActionLog[] {
  const labelToAction = new Map(
    Object.entries(ACTION_FIELD_LABELS).map(([action, label]) => [label, action])
  );

  return fields
    .map((field) => {
      const action = labelToAction.get(field.name);
      if (!action) {
        return null;
      }

      const reassignedMatch = field.value.match(/^(.+?) → (.+?) \((.+)\)$/);
      if (reassignedMatch) {
        return {
          action,
          discordUserId: "",
          discordUsername: reassignedMatch[1],
          timestamp: reassignedMatch[3],
          details: reassignedMatch[2],
        };
      }

      const simpleMatch = field.value.match(/^(.+?) \((.+)\)$/);
      if (!simpleMatch) {
        return null;
      }

      return {
        action,
        discordUserId: "",
        discordUsername: simpleMatch[1],
        timestamp: simpleMatch[2],
      };
    })
    .filter((entry): entry is TicketActionLog => entry !== null);
}

function bootstrapTicketFromInteraction(
  interaction: DiscordInteraction,
  ticketId: string
): TicketRecord | null {
  const message = interaction.message;
  const embed = message?.embeds?.[0];
  if (!message?.id || !message.channel_id || !embed) {
    return null;
  }

  const fields = embed.fields ?? [];
  const actionFieldNames = new Set(Object.values(ACTION_FIELD_LABELS));
  const baseFields = fields.filter(
    (field) =>
      field.name !== "Status" &&
      field.name !== "Assigned To" &&
      !actionFieldNames.has(field.name)
  );
  const statusField = fields.find((field) => field.name === "Status");
  const assignedField = fields.find((field) => field.name === "Assigned To");
  const subredditField = fields.find((field) => field.name === "Subreddit");
  const now = new Date().toISOString();

  const status = parseStatusLabel(statusField?.value ?? "Open");
  const assignedValue = assignedField?.value?.trim();
  // Only trust the assignee when the ticket is actually claimed; ignore
  // placeholder values so stale fields cannot block future claims.
  const assignedTo =
    status === "claimed" && assignedValue && !/^(unassigned|none|n\/a|—|-)$/i.test(assignedValue)
      ? assignedValue
      : undefined;

  return {
    id: ticketId,
    source: "modmail",
    subreddit: parseSubredditGroup(subredditField?.value ?? ""),
    status,
    assignedTo,
    webhookId: "",
    webhookToken: "",
    messageId: message.id,
    channelId: message.channel_id,
    baseEmbed: {
      title: embed.title,
      url: embed.url,
      description: embed.description,
      author: embed.author,
      fields: baseFields,
      color: embed.color,
      timestamp: embed.timestamp,
      footer: embed.footer,
    },
    baseColor: embed.color ?? STATUS_COLORS.open,
    actionLog: parseActionLogFromFields(fields),
    createdAt: now,
    updatedAt: now,
  };
}

async function resolveTicketForInteraction(
  env: Env,
  interaction: DiscordInteraction,
  ticketId: string
): Promise<TicketRecord | null> {
  const existing = await getTicketWithRetry(env, ticketId);
  if (existing) {
    return existing;
  }

  const bootstrapped = bootstrapTicketFromInteraction(interaction, ticketId);
  if (!bootstrapped) {
    return null;
  }

  await saveTicket(env, bootstrapped);
  return bootstrapped;
}

async function applyTicketAction(
  env: Env,
  ticket: TicketRecord,
  action: TicketAction,
  actor: { id: string; username: string },
  details?: string,
  assigneeDiscordId?: string
): Promise<TicketRecord> {
  const now = new Date().toISOString();
  const updated: TicketRecord = {
    ...ticket,
    actionLog: [
      ...ticket.actionLog,
      {
        action,
        discordUserId: actor.id,
        discordUsername: actor.username,
        timestamp: now,
        details,
      },
    ],
    updatedAt: now,
  };

  switch (action) {
    case "claim":
      updated.status = "claimed";
      updated.assignedTo = actor.username;
      updated.assignedToId = actor.id;
      break;
    case "unclaim":
      updated.status = "open";
      updated.assignedTo = undefined;
      updated.assignedToId = undefined;
      break;
    case "close":
      updated.status = "closed";
      break;
    case "reopen":
      // Always reopen as unassigned. Restoring the pre-close assignee
      // confused mods: the ticket silently became "claimed" again and
      // blocked everyone else from claiming it.
      updated.status = "open";
      updated.assignedTo = undefined;
      updated.assignedToId = undefined;
      break;
    case "resolved":
      updated.status = "resolved";
      break;
    case "unresolved":
      updated.status = "unresolved";
      break;
    case "reassign":
      updated.status = "claimed";
      updated.assignedTo = details ?? updated.assignedTo;
      if (assigneeDiscordId) {
        updated.assignedToId = assigneeDiscordId;
      }
      break;
  }

  await saveTicket(env, updated);
  return updated;
}

type ReportSnapshot = {
  subreddits: Record<
    string,
    {
      ticketsClaimed: number;
      ticketsClosed: number;
      ticketsResolved: number;
      ticketsUnresolved: number;
      ticketsReassigned: number;
      ticketsReopened: number;
      openUnclaimed: number;
      handlers: Record<string, Record<string, number>>;
    }
  >;
};

function createEmptySnapshot(): ReportSnapshot {
  const empty = () => ({
    ticketsClaimed: 0,
    ticketsClosed: 0,
    ticketsResolved: 0,
    ticketsUnresolved: 0,
    ticketsReassigned: 0,
    ticketsReopened: 0,
    openUnclaimed: 0,
    handlers: {} as Record<string, Record<string, number>>,
  });

  return {
    subreddits: {
      spectrum: empty(),
      spectrum_official: empty(),
    },
  };
}

async function trackAction(
  env: Env,
  subreddit: string,
  action: TicketAction,
  username: string
): Promise<void> {
  const raw = (await env.REPORT.get("snapshot")) ?? JSON.stringify(createEmptySnapshot());
  const snapshot = JSON.parse(raw) as ReportSnapshot;

  if (!snapshot.subreddits[subreddit]) {
    snapshot.subreddits[subreddit] = createEmptySnapshot().subreddits.spectrum;
  }

  const metrics = snapshot.subreddits[subreddit];
  const metricKey = {
    claim: "ticketsClaimed",
    close: "ticketsClosed",
    resolved: "ticketsResolved",
    unresolved: "ticketsUnresolved",
    reassign: "ticketsReassigned",
    reopen: "ticketsReopened",
  }[action] as keyof typeof metrics;

  if (typeof metrics[metricKey] === "number") {
    (metrics[metricKey] as number) += 1;
  }

  if (!metrics.handlers[username]) {
    metrics.handlers[username] = {};
  }
  metrics.handlers[username][action] = (metrics.handlers[username][action] ?? 0) + 1;

  const openRaw = (await env.TICKETS.get(OPEN_TICKETS_KEY)) ?? "{}";
  const openMap = JSON.parse(openRaw) as Record<string, string>;
  let openUnclaimed = 0;

  for (const id of Object.keys(openMap)) {
    const ticket = await getTicket(env, id);
    if (ticket?.subreddit === subreddit && ticket.status === "open" && !ticket.assignedTo) {
      openUnclaimed += 1;
    }
  }
  metrics.openUnclaimed = openUnclaimed;

  await env.REPORT.put("snapshot", JSON.stringify(snapshot));
}

function parseTicketCustomId(customId: string): { action: TicketAction; ticketId: string } | null {
  const match = customId.match(/^ticket:([a-z]+):(.+)$/);
  if (!match) {
    return null;
  }
  const action = match[1] as TicketAction;
  if (!TICKET_ACTIONS.includes(action)) {
    return null;
  }
  return { action, ticketId: match[2] };
}

function getInteractionUser(interaction: DiscordInteraction): { id: string; username: string } | null {
  const user = interaction.member?.user ?? interaction.user;
  if (!user) {
    return null;
  }
  return { id: user.id, username: user.global_name || user.username };
}

function isTicketActionAllowed(ticket: TicketRecord, action: TicketAction): string | null {
  const isFinal = ticket.status === "resolved" || ticket.status === "unresolved";
  const isClosed = ticket.status === "closed" || isFinal;

  switch (action) {
    case "claim":
      if (ticket.status === "claimed") return "This ticket is already claimed.";
      if (isClosed || isFinal) return "Closed or finalized tickets cannot be claimed.";
      return null;
    case "unclaim":
      if (ticket.status !== "claimed") return "Only claimed tickets can be unclaimed.";
      if (isClosed || isFinal) return "Closed or finalized tickets cannot be unclaimed.";
      return null;
    case "close":
      if (isClosed || isFinal) return "This ticket is already closed or finalized.";
      return null;
    case "reopen":
      if (!isClosed && !isFinal) return "Only closed or finalized tickets can be reopened.";
      return null;
    case "resolved":
    case "unresolved":
      if (isFinal) return "This ticket already has a final status.";
      return null;
    case "reassign":
      if (ticket.status !== "claimed") return "Only claimed tickets can be reassigned.";
      if (isFinal) return "Finalized tickets cannot be reassigned.";
      return null;
    default:
      return "Unknown action.";
  }
}

function truncateField(value: string): string {
  return value.length <= FIELD_LENGTH ? value : `${value.slice(0, FIELD_LENGTH - 15)}... (truncated)`;
}

function buildTicketEmbed(ticket: TicketRecord): Record<string, unknown> {
  const statusLabel = ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1);
  const baseFields = ((ticket.baseEmbed.fields as Array<{ name: string; value: string; inline?: boolean }>) ?? []).filter(
    (field) =>
      field.name !== "Status" &&
      field.name !== "Assigned To" &&
      !Object.values(ACTION_FIELD_LABELS).includes(field.name)
  );

  const fields = [
    ...baseFields,
    { name: "Status", value: truncateField(statusLabel), inline: true },
  ];

  if (ticket.assignedTo) {
    fields.push({ name: "Assigned To", value: truncateField(ticket.assignedTo), inline: true });
  }

  for (const entry of ticket.actionLog) {
    const label = ACTION_FIELD_LABELS[entry.action as TicketAction] ?? entry.action;
    const value = entry.details
      ? `${entry.discordUsername} → ${entry.details} (${entry.timestamp})`
      : `${entry.discordUsername} (${entry.timestamp})`;
    fields.push({ name: label, value: truncateField(value), inline: false });
  }

  return {
    ...ticket.baseEmbed,
    fields: fields.slice(0, 25),
    color: STATUS_COLORS[ticket.status] ?? ticket.baseColor,
    timestamp: ticket.updatedAt,
  };
}

function buildTicketButtons(ticketId: string, status: TicketStatus): unknown[] {
  const isFinal = status === "resolved" || status === "unresolved";
  const isClosed = status === "closed" || isFinal;

  const buttons = TICKET_ACTIONS.map((action) => {
    let disabled = false;
    let style = 2;

    switch (action) {
      case "claim":
        style = 1;
        disabled = status === "claimed" || isClosed || isFinal;
        break;
      case "unclaim":
        style = 2;
        disabled = status !== "claimed" || isClosed || isFinal;
        break;
      case "close":
        style = 4;
        disabled = isClosed || isFinal;
        break;
      case "reopen":
        style = 2;
        disabled = !isClosed && !isFinal;
        break;
      case "resolved":
        style = 3;
        disabled = isFinal;
        break;
      case "unresolved":
        style = 4;
        disabled = isFinal;
        break;
      case "reassign":
        style = 1;
        disabled = status !== "claimed" || isFinal;
        break;
    }

    return {
      type: 2,
      style,
      label: BUTTON_LABELS[action],
      custom_id: `ticket:${action}:${ticketId}`,
      disabled,
    };
  });

  return [
    { type: 1, components: buttons.slice(0, 4) },
    { type: 1, components: buttons.slice(4) },
  ];
}

function normalizeDiscordUserId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  const mentionMatch = trimmed.match(/^<@!?(\d+)>$/);
  const digits = mentionMatch?.[1] ?? trimmed.replace(/\D/g, "");
  return /^\d{17,20}$/.test(digits) ? digits : undefined;
}

function parseReassignModalValues(interaction: DiscordInteraction): {
  assigneeName: string;
  assigneeDiscordId?: string;
} {
  const fields =
    interaction.data?.components?.flatMap((row) => row.components ?? []) ?? [];
  const assigneeName = fields.find((field) => field.custom_id === "assignee_name")?.value?.trim() ?? "";
  const assigneeDiscordId = normalizeDiscordUserId(
    fields.find((field) => field.custom_id === "assignee_discord_id")?.value
  );

  return { assigneeName, assigneeDiscordId };
}

function buildUpdateMessageResponse(ticket: TicketRecord, pingUserId?: string): unknown {
  const data: Record<string, unknown> = {
    embeds: [buildTicketEmbed(ticket)],
    components: buildTicketButtons(ticket.id, ticket.status),
  };

  if (pingUserId) {
    data.content = `<@${pingUserId}> You have been assigned this ticket.`;
    data.allowed_mentions = { parse: [], users: [pingUserId] };
  }

  return { type: 7, data };
}

async function getWebhookChannelId(webhookId: string, webhookToken: string): Promise<string | null> {
  const response = await fetch(`https://discord.com/api/v10/webhooks/${webhookId}/${webhookToken}`);
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as { channel_id?: string };
  return data.channel_id ?? null;
}

async function sendDiscordBotMessage(
  botToken: string,
  channelId: string,
  payload: Record<string, unknown>
): Promise<{ id: string; channel_id: string } | null> {
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.error("Failed to send Discord bot message:", response.status, await response.text());
    return null;
  }

  return (await response.json()) as { id: string; channel_id: string };
}

async function deleteDiscordMessage(
  botToken: string,
  channelId: string,
  messageId: string
): Promise<boolean> {
  const response = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    }
  );

  return response.ok || response.status === 404;
}

async function deleteDiscordThread(botToken: string, threadId: string): Promise<void> {
  const response = await fetch(`https://discord.com/api/v10/channels/${threadId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bot ${botToken}`,
    },
  });
  if (!response.ok && response.status !== 404) {
    console.error(
      `Failed to delete Discord thread ${threadId}: ${response.status}`,
      await response.text().catch(() => "")
    );
  }
}

async function createDiscordThreadFromMessage(
  botToken: string,
  channelId: string,
  messageId: string,
  threadName: string
): Promise<string | null> {
  const response = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/threads`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: threadName.slice(0, 100),
        auto_archive_duration: 10080,
      }),
    }
  );

  if (!response.ok) {
    console.error("Failed to create Discord thread:", response.status, await response.text());
    return null;
  }

  const thread = (await response.json()) as { id?: string };
  return thread.id ?? null;
}

function buildTicketMessagePayload(ticket: TicketRecord): Record<string, unknown> {
  return {
    embeds: [buildTicketEmbed(ticket)],
    components: buildTicketButtons(ticket.id, ticket.status),
  };
}

function parseWebhookUrl(webhookUrl: string): ClosedWebhookCredentials | null {
  const match = webhookUrl.trim().match(/\/api\/webhooks\/(\d+)\/([^/?]+)/);
  if (!match) {
    return null;
  }
  return {
    webhookId: match[1],
    webhookToken: match[2],
  };
}

async function getClosedWebhookConfig(env: Env): Promise<ClosedWebhookConfig | null> {
  const raw = await env.TICKETS.get(CLOSED_WEBHOOKS_CONFIG_KEY);
  return raw ? (JSON.parse(raw) as ClosedWebhookConfig) : null;
}

async function mergeClosedWebhookFromTicket(env: Env, ticket: TicketRecord): Promise<void> {
  if (!ticket.closedWebhookId?.trim() || !ticket.closedWebhookToken?.trim()) {
    return;
  }

  const group = ticket.subreddit === "spectrum_official" ? "spectrum_official" : "spectrum";
  const existing = (await getClosedWebhookConfig(env)) ?? {};
  const merged: ClosedWebhookConfig = {
    ...existing,
    [group]: {
      webhookId: ticket.closedWebhookId,
      webhookToken: ticket.closedWebhookToken,
    },
    syncedAt: new Date().toISOString(),
  };

  await env.TICKETS.put(CLOSED_WEBHOOKS_CONFIG_KEY, JSON.stringify(merged));
}

async function getHealthStatusWithSync(env: Env): Promise<Response> {
  const kvConfig = await getClosedWebhookConfig(env);
  return Response.json({
    ...getHealthStatus(env),
    closedWebhooksFromReddit: {
      spectrum: Boolean(kvConfig?.spectrum?.webhookId),
      spectrum_official: Boolean(kvConfig?.spectrum_official?.webhookId),
    },
    lastClosedWebhookSyncAt: kvConfig?.syncedAt ?? null,
  });
}

function getClosedWebhookFromEnv(
  env: Env,
  subreddit: string
): ClosedWebhookCredentials | null {
  const envUrl =
    subreddit === "spectrum_official"
      ? env.CLOSED_TICKETS_WEBHOOK_SPECTRUM_OFFICIAL
      : env.CLOSED_TICKETS_WEBHOOK_SPECTRUM;
  if (!envUrl?.trim()) {
    return null;
  }
  return parseWebhookUrl(envUrl);
}

async function resolveClosedWebhookCredentials(
  env: Env,
  ticket: TicketRecord
): Promise<ClosedWebhookCredentials | null> {
  if (ticket.closedWebhookId?.trim() && ticket.closedWebhookToken?.trim()) {
    return {
      webhookId: ticket.closedWebhookId,
      webhookToken: ticket.closedWebhookToken,
    };
  }

  const config = await getClosedWebhookConfig(env);
  const group = ticket.subreddit === "spectrum_official" ? "spectrum_official" : "spectrum";
  const fromConfig = config?.[group];
  if (fromConfig?.webhookId && fromConfig.webhookToken) {
    return fromConfig;
  }

  return getClosedWebhookFromEnv(env, group);
}

type ArchiveTicketResult = {
  ticket: TicketRecord;
  error?: string;
};

async function archiveTicketToClosedChannel(
  env: Env,
  ticket: TicketRecord,
  botToken: string
): Promise<ArchiveTicketResult> {
  if (ticket.archived) {
    return { ticket };
  }

  const closedWebhook = await resolveClosedWebhookCredentials(env, ticket);
  if (!closedWebhook) {
    return {
      ticket,
      error:
        "Closed tickets webhook is not configured. Add Discord Webhook 7 in Reddit app settings, save changes, then try again on a new alert.",
    };
  }

  const closedChannelId = await getWebhookChannelId(
    closedWebhook.webhookId,
    closedWebhook.webhookToken
  );
  if (!closedChannelId) {
    return {
      ticket,
      error: "Could not resolve the closed tickets channel from Webhook 7. Check the webhook URL.",
    };
  }

  const activeChannelId = ticket.channelId;
  const activeMessageId = ticket.messageId;
  const archivedMessage = await sendDiscordBotMessage(
    botToken,
    closedChannelId,
    buildTicketMessagePayload({
      ...ticket,
      closedWebhookId: closedWebhook.webhookId,
      closedWebhookToken: closedWebhook.webhookToken,
    })
  );
  if (!archivedMessage) {
    return {
      ticket,
      error:
        "Could not post to the closed tickets channel. Confirm the bot can send messages and use buttons in that channel.",
    };
  }

  if (ticket.threadId) {
    await deleteDiscordThread(botToken, ticket.threadId);
  }

  const deleted = await deleteDiscordMessage(botToken, activeChannelId, activeMessageId);
  if (!deleted) {
    console.error(
      `Archived ticket ${ticket.id} to closed channel but failed to delete active message ${activeMessageId}.`
    );
  }

  const updated: TicketRecord = {
    ...ticket,
    archived: true,
    activeWebhookId: ticket.webhookId,
    activeWebhookToken: ticket.webhookToken,
    activeChannelId,
    activeMessageId,
    closedWebhookId: closedWebhook.webhookId,
    closedWebhookToken: closedWebhook.webhookToken,
    webhookId: closedWebhook.webhookId,
    webhookToken: closedWebhook.webhookToken,
    channelId: archivedMessage.channel_id,
    messageId: archivedMessage.id,
  };

  await saveTicket(env, updated);
  return { ticket: updated };
}

async function restoreTicketToActiveChannel(
  env: Env,
  ticket: TicketRecord,
  botToken: string
): Promise<TicketRecord> {
  if (!ticket.archived || !ticket.activeChannelId) {
    return ticket;
  }

  await deleteDiscordMessage(botToken, ticket.channelId, ticket.messageId);

  const restoredMessage = await sendDiscordBotMessage(
    botToken,
    ticket.activeChannelId,
    buildTicketMessagePayload(ticket)
  );
  if (!restoredMessage) {
    return ticket;
  }

  let threadId = ticket.threadId;
  const threadName =
    typeof ticket.baseEmbed.title === "string" ? ticket.baseEmbed.title : "Ticket thread";
  const newThreadId = await createDiscordThreadFromMessage(
    botToken,
    restoredMessage.channel_id,
    restoredMessage.id,
    threadName
  );
  if (newThreadId) {
    threadId = newThreadId;
  }

  const updated: TicketRecord = {
    ...ticket,
    archived: false,
    webhookId: ticket.activeWebhookId ?? ticket.webhookId,
    webhookToken: ticket.activeWebhookToken ?? ticket.webhookToken,
    channelId: restoredMessage.channel_id,
    messageId: restoredMessage.id,
    threadId,
  };

  await saveTicket(env, updated);
  return updated;
}

function archiveActionLabel(action: TicketAction): string {
  return ACTION_FIELD_LABELS[action] ?? "Updated";
}

async function sendInteractionFollowup(
  interaction: DiscordInteraction,
  content: string
): Promise<void> {
  if (!interaction.application_id || !interaction.token) {
    console.error("Missing interaction application_id or token for follow-up message.");
    return;
  }

  const response = await fetch(
    `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content,
        flags: 64,
      }),
    }
  );

  if (!response.ok) {
    console.error(
      "Failed to send Discord interaction follow-up:",
      response.status,
      await response.text()
    );
  }
}

async function finalizeTicketInteraction(
  env: Env,
  previous: TicketRecord,
  updated: TicketRecord,
  action: TicketAction,
  interaction: DiscordInteraction,
  ctx: ExecutionContext,
  pingUserId?: string
): Promise<Response> {
  const botToken = env.DISCORD_BOT_TOKEN?.trim();

  if (action === "reopen" && previous.archived && botToken) {
    ctx.waitUntil(
      restoreTicketToActiveChannel(env, updated, botToken)
        .then((restored) =>
          sendInteractionFollowup(
            interaction,
            restored.archived
              ? "Could not reopen ticket in the active channel."
              : "Ticket reopened in the active channel."
          )
        )
        .catch((error) => {
          console.error("Reopen restore failed:", error);
          return sendInteractionFollowup(interaction, "Could not reopen ticket.");
        })
    );
    return interactionResponse(
      ephemeral("Reopening ticket and moving it back to the active channel...")
    );
  }

  if (ARCHIVE_ACTIONS.has(action)) {
    const response = interactionResponse(buildUpdateMessageResponse(updated, pingUserId));

    ctx.waitUntil(
      (async () => {
        if (!botToken) {
          await sendInteractionFollowup(
            interaction,
            `${archiveActionLabel(action)} in place. Add DISCORD_BOT_TOKEN on the Cloudflare Worker to move tickets to the closed queue.`
          );
          return;
        }

        const closedWebhook = await resolveClosedWebhookCredentials(env, updated);
        if (!closedWebhook) {
          await sendInteractionFollowup(
            interaction,
            `${archiveActionLabel(action)} in place. The closed-tickets channel is not configured on the Cloudflare Worker. In Cloudflare Worker secrets, add \`CLOSED_TICKETS_WEBHOOK_SPECTRUM\` with the full Discord Webhook 7 URL (e.g. https://discord.com/api/webhooks/123/token). Check that the URL is complete and contains /api/webhooks/.`
          );
          return;
        }

        const result = await archiveTicketToClosedChannel(env, updated, botToken);
        if (result.ticket.archived) {
          await sendInteractionFollowup(
            interaction,
            `${archiveActionLabel(action)}. Ticket moved to the closed queue.`
          );
          return;
        }

        await sendInteractionFollowup(
          interaction,
          `${archiveActionLabel(action)} in place. ${result.error ?? "Could not move ticket."}`
        );
      })().catch((error) => {
        console.error("Archive follow-up failed:", error);
      })
    );

    return response;
  }

  return interactionResponse(buildUpdateMessageResponse(updated, pingUserId));
}

function buildReassignModal(ticketId: string): unknown {
  return {
    type: 9,
    data: {
      custom_id: `reassign:${ticketId}`,
      title: "Reassign Ticket",
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "assignee_name",
              label: "Team member name",
              style: 1,
              min_length: 1,
              max_length: 100,
              placeholder: "Enter the name of the team member",
              required: true,
            },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "assignee_discord_id",
              label: "Discord User ID",
              style: 1,
              min_length: 0,
              max_length: 25,
              placeholder: "Right-click user → Copy User ID (for ping)",
              required: false,
            },
          ],
        },
      ],
    },
  };
}

function ephemeral(content: string): unknown {
  return { type: 4, data: { content, flags: 64 } };
}

function interactionResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}