/**
 * Cloudflare Worker: Discord button interactions for Spectrum Modmail Bot.
 * Discord POSTs button clicks here (public). Devvit POSTs new tickets here on register.
 */

export interface Env {
  TICKETS: KVNamespace;
  REPORT: KVNamespace;
  DISCORD_PUBLIC_KEY: string;
  WORKER_SECRET: string;
}

type TicketAction =
  | "claim"
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
  baseEmbed: Record<string, unknown>;
  baseColor: number;
  content?: string;
  actionLog: TicketActionLog[];
  createdAt: string;
  updatedAt: string;
};

const TICKET_ACTIONS: TicketAction[] = [
  "claim",
  "close",
  "reopen",
  "resolved",
  "unresolved",
  "reassign",
];

const BUTTON_LABELS: Record<TicketAction, string> = {
  claim: "Claim",
  close: "Close",
  reopen: "Reopen",
  resolved: "Resolved",
  unresolved: "Unresolved",
  reassign: "Reassign",
};

const ACTION_FIELD_LABELS: Record<TicketAction, string> = {
  claim: "Claimed",
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/tickets/register") {
      return registerTicket(request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/report/snapshot") {
      return getReportSnapshot(request, env);
    }

    if (request.method === "POST" && (url.pathname === "/" || url.pathname === "/discord/interactions")) {
      return handleDiscordInteraction(request, env);
    }

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Spectrum Modmail Discord interactions worker", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
};

function authorizeWorker(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization") ?? "";
  return auth === `Bearer ${env.WORKER_SECRET}`;
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

async function handleDiscordInteraction(request: Request, env: Env): Promise<Response> {
  const rawBody = await request.text();

  if (!(await verifyDiscordSignature(request, rawBody, env.DISCORD_PUBLIC_KEY))) {
    return new Response("Invalid signature", { status: 401 });
  }

  const interaction = JSON.parse(rawBody) as DiscordInteraction;

  if (interaction.type === 1) {
    return Response.json({ type: 1 });
  }

  if (interaction.type === 3) {
    return handleButton(interaction, env);
  }

  if (interaction.type === 5) {
    return handleModal(interaction, env);
  }

  return Response.json(ephemeral("Unsupported interaction type."));
}

type DiscordInteraction = {
  type: number;
  member?: { user?: { id: string; username: string; global_name?: string } };
  user?: { id: string; username: string; global_name?: string };
  data?: {
    custom_id?: string;
    components?: Array<{ components?: Array<{ value?: string }> }>;
  };
};

async function handleButton(interaction: DiscordInteraction, env: Env): Promise<Response> {
  const customId = interaction.data?.custom_id;
  if (!customId) {
    return Response.json(ephemeral("Missing button id."));
  }

  const parsed = parseTicketCustomId(customId);
  if (!parsed) {
    return Response.json(ephemeral("Unknown button."));
  }

  const actor = getInteractionUser(interaction);
  if (!actor) {
    return Response.json(ephemeral("Unable to identify Discord user."));
  }

  const ticket = await getTicket(env, parsed.ticketId);
  if (!ticket) {
    return Response.json(ephemeral("Ticket not found. It may not have synced from Reddit yet."));
  }

  if (parsed.action === "reassign") {
    const err = isTicketActionAllowed(ticket, parsed.action);
    if (err) {
      return Response.json(ephemeral(err));
    }
    return Response.json(buildReassignModal(parsed.ticketId));
  }

  const err = isTicketActionAllowed(ticket, parsed.action);
  if (err) {
    return Response.json(ephemeral(err));
  }

  const updated = await applyTicketAction(env, ticket, parsed.action, actor);
  await trackAction(env, updated.subreddit, parsed.action, actor.username);
  await editWebhookMessage(updated);
  return Response.json(buildUpdateMessageResponse(updated));
}

async function handleModal(interaction: DiscordInteraction, env: Env): Promise<Response> {
  const customId = interaction.data?.custom_id;
  if (!customId?.startsWith("reassign:")) {
    return Response.json(ephemeral("Unknown modal."));
  }

  const ticketId = customId.replace("reassign:", "");
  const assigneeName =
    interaction.data?.components?.[0]?.components?.[0]?.value?.trim() ?? "";

  if (!assigneeName) {
    return Response.json(ephemeral("Please enter a team member name."));
  }

  const actor = getInteractionUser(interaction);
  if (!actor) {
    return Response.json(ephemeral("Unable to identify Discord user."));
  }

  const ticket = await getTicket(env, ticketId);
  if (!ticket) {
    return Response.json(ephemeral("Ticket not found."));
  }

  const err = isTicketActionAllowed(ticket, "reassign");
  if (err) {
    return Response.json(ephemeral(err));
  }

  const updated = await applyTicketAction(env, ticket, "reassign", actor, assigneeName);
  await trackAction(env, updated.subreddit, "reassign", actor.username);
  await editWebhookMessage(updated);
  return Response.json(buildUpdateMessageResponse(updated));
}

async function saveTicket(env: Env, ticket: TicketRecord): Promise<void> {
  await env.TICKETS.put(`ticket:${ticket.id}`, JSON.stringify(ticket));

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

async function applyTicketAction(
  env: Env,
  ticket: TicketRecord,
  action: TicketAction,
  actor: { id: string; username: string },
  details?: string
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
    case "close":
      updated.status = "closed";
      break;
    case "reopen":
      updated.status = updated.assignedTo ? "claimed" : "open";
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
    { type: 1, components: buttons.slice(0, 3) },
    { type: 1, components: buttons.slice(3) },
  ];
}

function buildUpdateMessageResponse(ticket: TicketRecord): unknown {
  return {
    type: 7,
    data: {
      embeds: [buildTicketEmbed(ticket)],
      components: buildTicketButtons(ticket.id, ticket.status),
    },
  };
}

async function editWebhookMessage(ticket: TicketRecord): Promise<boolean> {
  const url = `https://discord.com/api/webhooks/${ticket.webhookId}/${ticket.webhookToken}/messages/${ticket.messageId}?with_components=true`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      embeds: [buildTicketEmbed(ticket)],
      components: buildTicketButtons(ticket.id, ticket.status),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`Webhook message edit failed: ${response.status} ${body}`);
    return false;
  }

  return true;
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
      ],
    },
  };
}

function ephemeral(content: string): unknown {
  return { type: 4, data: { content, flags: 64 } };
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function verifyDiscordSignature(
  request: Request,
  body: string,
  publicKeyHex: string
): Promise<boolean> {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");

  if (!signature || !timestamp || !publicKeyHex) {
    return false;
  }

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToUint8Array(publicKeyHex),
      { name: "Ed25519", namedCurve: "Ed25519" },
      false,
      ["verify"]
    );

    return crypto.subtle.verify(
      "Ed25519",
      key,
      hexToUint8Array(signature),
      new TextEncoder().encode(timestamp + body)
    );
  } catch {
    return false;
  }
}
