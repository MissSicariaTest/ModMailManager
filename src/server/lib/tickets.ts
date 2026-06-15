import { redis } from "@devvit/web/server";
import {
  OPEN_TICKETS_REDIS_KEY,
  TICKET_REDIS_PREFIX,
} from "../../shared/constants.js";
import type {
  TicketActionLog,
  TicketRecord,
  TicketStatus,
} from "../../shared/types.js";
import type { TicketAction } from "../../shared/constants.js";
import type { MonitoredSubreddit } from "../../shared/subreddit.js";

function ticketKey(ticketId: string): string {
  return `${TICKET_REDIS_PREFIX}${ticketId}`;
}

export async function saveTicket(ticket: TicketRecord): Promise<void> {
  await redis.set(ticketKey(ticket.id), JSON.stringify(ticket));
  if (ticket.status === "open" || ticket.status === "claimed") {
    await redis.hSet(OPEN_TICKETS_REDIS_KEY, { [ticket.id]: ticket.status });
  } else {
    await redis.hDel(OPEN_TICKETS_REDIS_KEY, [ticket.id]);
  }
}

export async function getTicket(ticketId: string): Promise<TicketRecord | null> {
  const raw = await redis.get(ticketKey(ticketId));
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as TicketRecord;
}

export async function countOpenUnclaimedTickets(
  subreddit?: MonitoredSubreddit
): Promise<number> {
  const entries = await redis.hGetAll(OPEN_TICKETS_REDIS_KEY);
  if (!entries || Object.keys(entries).length === 0) {
    return 0;
  }

  let count = 0;
  for (const ticketId of Object.keys(entries)) {
    const ticket = await getTicket(ticketId);
    if (!ticket) {
      continue;
    }
    if (subreddit && ticket.subreddit !== subreddit) {
      continue;
    }
    if (ticket.status === "open" && !ticket.assignedTo) {
      count += 1;
    }
  }
  return count;
}

export async function applyTicketAction(
  ticket: TicketRecord,
  action: TicketAction,
  actor: { id: string; username: string },
  details?: string,
  assigneeDiscordId?: string
): Promise<TicketRecord> {
  const now = new Date().toISOString();
  const logEntry: TicketActionLog = {
    action,
    discordUserId: actor.id,
    discordUsername: actor.username,
    timestamp: now,
    details,
  };

  const updated: TicketRecord = {
    ...ticket,
    actionLog: [...ticket.actionLog, logEntry],
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
      if (assigneeDiscordId) {
        updated.assignedToId = assigneeDiscordId;
      }
      break;
  }

  await saveTicket(updated);
  return updated;
}

export function isTicketActionAllowed(
  ticket: TicketRecord,
  action: TicketAction
): string | null {
  const isFinal = ticket.status === "resolved" || ticket.status === "unresolved";
  const isClosed = ticket.status === "closed" || isFinal;

  switch (action) {
    case "claim":
      if (ticket.status === "claimed") {
        return "This ticket is already claimed.";
      }
      if (isClosed || isFinal) {
        return "Closed or finalized tickets cannot be claimed.";
      }
      return null;
    case "unclaim":
      if (ticket.status !== "claimed") {
        return "Only claimed tickets can be unclaimed.";
      }
      if (isClosed || isFinal) {
        return "Closed or finalized tickets cannot be unclaimed.";
      }
      return null;
    case "close":
      if (isClosed || isFinal) {
        return "This ticket is already closed or finalized.";
      }
      return null;
    case "reopen":
      if (!isClosed && !isFinal) {
        return "Only closed or finalized tickets can be reopened.";
      }
      return null;
    case "resolved":
    case "unresolved":
      if (isFinal) {
        return "This ticket already has a final status.";
      }
      return null;
    case "reassign":
      if (ticket.status !== "claimed") {
        return "Only claimed tickets can be reassigned.";
      }
      if (isFinal) {
        return "Finalized tickets cannot be reassigned.";
      }
      return null;
    default:
      return "Unknown action.";
  }
}

export function getOpenTicketStatuses(): TicketStatus[] {
  return ["open", "claimed"];
}
