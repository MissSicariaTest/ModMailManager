import { verify } from "node:crypto";
import {
  ACTION_FIELD_LABELS,
  BUTTON_LABELS,
  DISCORD_WEBHOOK_HOSTS,
  FIELD_LENGTH,
  STATUS_COLORS,
  TICKET_ACTIONS,
  TITLE_LENGTH,
} from "../../shared/constants.js";
import type {
  DiscordActionRow,
  DiscordEmbed,
  DiscordEmbedField,
  DiscordWebhookMessage,
  DiscordWebhookPayload,
  ParsedWebhook,
  TicketActionLog,
  TicketRecord,
  TicketStatus,
} from "../../shared/types.js";
import type { TicketAction } from "../../shared/constants.js";

export function truncateDescription(description: string, maxLength: number = 4096): string {
  if (description.length <= maxLength) {
    return description;
  }
  const truncationIndicator = "... (truncated)";
  return description.substring(0, maxLength - truncationIndicator.length) + truncationIndicator;
}

export function truncateField(value: string): string {
  return truncateDescription(value, FIELD_LENGTH);
}

export function truncateTitle(value: string): string {
  return truncateDescription(value, TITLE_LENGTH);
}

export function previewText(text: string, maxLength: number = 300): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.substring(0, maxLength)}...`;
}

export function isDiscordWebhook(webhook: string): boolean {
  return DISCORD_WEBHOOK_HOSTS.some((host) =>
    webhook.startsWith(`https://${host}/api/webhooks/`)
  );
}

export function redditProfileUrl(username: string): string {
  return `https://www.reddit.com/u/${username}`;
}

export function redditPermalinkUrl(permalink: string): string {
  if (permalink.startsWith("http")) {
    return permalink;
  }
  return `https://www.reddit.com${permalink}`;
}

export function parseWebhookUrl(webhookUrl: string): ParsedWebhook | null {
  const match = webhookUrl.match(/\/api\/webhooks\/(\d+)\/([^/?]+)/);
  if (!match) {
    return null;
  }
  return {
    id: match[1],
    token: match[2],
    url: webhookUrl.split("?")[0],
  };
}

export function buildTicketButtons(ticketId: string, status: TicketStatus): DiscordActionRow[] {
  const isFinal = status === "resolved" || status === "unresolved";
  const isClosed = status === "closed" || isFinal;

  const buttons = TICKET_ACTIONS.map((action) => {
    let disabled = false;
    let style: 1 | 2 | 3 | 4 = 2;

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
      type: 2 as const,
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

function formatDiscordTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

function buildActionLogFields(actionLog: TicketActionLog[]): DiscordEmbedField[] {
  return actionLog.map((entry) => ({
    name: ACTION_FIELD_LABELS[entry.action as TicketAction] ?? entry.action,
    value: truncateField(
      entry.details
        ? `${entry.discordUsername} → ${entry.details} (${formatDiscordTimestamp(entry.timestamp)})`
        : `${entry.discordUsername} (${formatDiscordTimestamp(entry.timestamp)})`
    ),
    inline: false,
  }));
}

export function buildTicketEmbed(ticket: TicketRecord): DiscordEmbed {
  const statusLabel =
    ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1);
  const baseFields = (ticket.baseEmbed.fields ?? []).filter(
    (field) =>
      field.name !== "Status" &&
      field.name !== "Assigned To" &&
      !Object.values(ACTION_FIELD_LABELS).includes(field.name)
  );

  const fields: DiscordEmbedField[] = [
    ...baseFields,
    {
      name: "Status",
      value: truncateField(statusLabel),
      inline: true,
    },
  ];

  if (ticket.assignedTo) {
    fields.push({
      name: "Assigned To",
      value: truncateField(ticket.assignedTo),
      inline: true,
    });
  }

  fields.push(...buildActionLogFields(ticket.actionLog));

  return {
    ...ticket.baseEmbed,
    fields: fields.slice(0, 25),
    color: STATUS_COLORS[ticket.status] ?? ticket.baseColor,
    timestamp: ticket.updatedAt,
  };
}

export function buildTicketPayload(ticket: TicketRecord): DiscordWebhookPayload {
  return {
    content: ticket.content,
    embeds: [buildTicketEmbed(ticket)],
    components: buildTicketButtons(ticket.id, ticket.status),
  };
}

export async function getWebhookChannelId(
  webhookId: string,
  webhookToken: string
): Promise<string | null> {
  const response = await fetch(`https://discord.com/api/v10/webhooks/${webhookId}/${webhookToken}`);
  if (!response.ok) {
    console.error(`Unable to resolve webhook channel: ${response.status}`);
    return null;
  }

  const data = (await response.json()) as { channel_id?: string };
  return data.channel_id ?? null;
}

export async function sendDiscordBotMessage(
  botToken: string,
  channelId: string,
  payload: DiscordWebhookPayload
): Promise<DiscordWebhookMessage | null> {
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(
      `Error sending bot message to Discord: ${response.status} ${response.statusText} ${body}`
    );
    return null;
  }

  return (await response.json()) as DiscordWebhookMessage;
}

export function buildWebhookRequestUrl(
  webhook: string,
  options?: { wait?: boolean; withComponents?: boolean }
): string {
  const params = new URLSearchParams();
  if (options?.wait) {
    params.set("wait", "true");
  }
  if (options?.withComponents) {
    params.set("with_components", "true");
  }

  const query = params.toString();
  const base = webhook.split("?")[0];
  return query ? `${base}?${query}` : base;
}

export function messageHasInteractiveButtons(message: DiscordWebhookMessage): boolean {
  return (message.components ?? []).some((row) =>
    row.components?.some((button) => Boolean(button.custom_id))
  );
}

export async function sendDiscordWebhook(
  webhook: string,
  payload: DiscordWebhookPayload,
  wait = false
): Promise<DiscordWebhookMessage | null> {
  const withComponents = Boolean(payload.components?.length);
  const url = buildWebhookRequestUrl(webhook, { wait, withComponents });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(
      `Error sending data to webhook: ${response.status} ${response.statusText} ${body}`
    );
    return null;
  }

  if (!wait) {
    return null;
  }

  return (await response.json()) as DiscordWebhookMessage;
}

export async function editDiscordWebhookMessage(
  ticket: TicketRecord
): Promise<boolean> {
  const payload = buildTicketPayload(ticket);
  const url = `https://discord.com/api/webhooks/${ticket.webhookId}/${ticket.webhookToken}/messages/${ticket.messageId}?with_components=true`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(
      `Error editing webhook message: ${response.status} ${response.statusText} ${body}`
    );
    return false;
  }

  return true;
}

export function verifyDiscordSignature(
  rawBody: string,
  signature: string | undefined,
  timestamp: string | undefined,
  publicKeyHex: string | undefined
): boolean {
  if (!signature || !timestamp || !publicKeyHex) {
    return false;
  }

  try {
    return verify(
      "Ed25519",
      Buffer.from(timestamp + rawBody),
      Buffer.from(publicKeyHex, "hex"),
      Buffer.from(signature, "hex")
    );
  } catch (error) {
    console.error("Discord signature verification failed:", error);
    return false;
  }
}

export function parseTicketCustomId(customId: string): {
  action: TicketAction;
  ticketId: string;
} | null {
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

export function getInteractionUser(interaction: {
  member?: { user?: { id: string; username: string; global_name?: string } };
  user?: { id: string; username: string; global_name?: string };
}): { id: string; username: string } | null {
  const user = interaction.member?.user ?? interaction.user;
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    username: user.global_name || user.username,
  };
}

export function normalizeDiscordUserId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  const mentionMatch = trimmed.match(/^<@!?(\d+)>$/);
  const digits = mentionMatch?.[1] ?? trimmed.replace(/\D/g, "");
  return /^\d{17,20}$/.test(digits) ? digits : undefined;
}

export function parseReassignModalValues(interaction: {
  data?: {
    components?: Array<{ components?: Array<{ custom_id?: string; value?: string }> }>;
  };
}): { assigneeName: string; assigneeDiscordId?: string } {
  const fields =
    interaction.data?.components?.flatMap((row) => row.components ?? []) ?? [];
  const assigneeName = fields.find((field) => field.custom_id === "assignee_name")?.value?.trim() ?? "";
  const assigneeDiscordId = normalizeDiscordUserId(
    fields.find((field) => field.custom_id === "assignee_discord_id")?.value
  );

  return { assigneeName, assigneeDiscordId };
}

export function buildReassignModal(ticketId: string) {
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

export function buildUpdateMessageResponse(ticket: TicketRecord, pingUserId?: string) {
  const payload = buildTicketPayload(ticket);
  return {
    type: 7,
    data: {
      content: pingUserId
        ? `<@${pingUserId}> You have been assigned this ticket.`
        : undefined,
      allowed_mentions: pingUserId ? { parse: [] as string[], users: [pingUserId] } : undefined,
      embeds: payload.embeds,
      components: payload.components,
    },
  };
}

export function buildEphemeralResponse(content: string) {
  return {
    type: 4,
    data: {
      content,
      flags: 64,
    },
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createTicketId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
