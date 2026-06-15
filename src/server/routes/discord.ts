import { Hono } from "hono";
import { settings } from "@devvit/web/server";
import type { DiscordInteraction } from "../../shared/types.js";
import type { TicketAction } from "../../shared/constants.js";
import {
  buildEphemeralResponse,
  buildReassignModal,
  buildUpdateMessageResponse,
  getErrorMessage,
  getInteractionUser,
  parseTicketCustomId,
  verifyDiscordSignature,
} from "../lib/discord.js";
import { trackTicketActionForReport } from "../lib/reporting.js";
import {
  applyTicketAction,
  getTicket,
  isTicketActionAllowed,
} from "../lib/tickets.js";

export const discordRoutes = new Hono();

discordRoutes.post("/interactions", async (c) => {
  const signature = c.req.header("X-Signature-Ed25519");
  const timestamp = c.req.header("X-Signature-Timestamp");
  const rawBody = await c.req.text();
  const publicKey = (await settings.get("discordApplicationPublicKey")) as string | undefined;

  if (!verifyDiscordSignature(rawBody, signature, timestamp, publicKey)) {
    return c.body("Invalid request signature", 401);
  }

  const interaction = JSON.parse(rawBody) as DiscordInteraction;

  if (interaction.type === 1) {
    return c.json({ type: 1 });
  }

  if (interaction.type === 3) {
    return handleButtonInteraction(c, interaction);
  }

  if (interaction.type === 5) {
    return handleModalSubmit(c, interaction);
  }

  return c.json(buildEphemeralResponse("Unsupported interaction type."), 200);
});

async function handleButtonInteraction(
  c: { json: (body: unknown, status?: number) => Response },
  interaction: DiscordInteraction
) {
  const customId = interaction.data?.custom_id;
  if (!customId) {
    return c.json(buildEphemeralResponse("Missing button id."), 200);
  }

  const parsed = parseTicketCustomId(customId);
  if (!parsed) {
    return c.json(buildEphemeralResponse("Unknown button."), 200);
  }

  const actor = getInteractionUser(interaction);
  if (!actor) {
    return c.json(buildEphemeralResponse("Unable to identify Discord user."), 200);
  }

  const ticket = await getTicket(parsed.ticketId);
  if (!ticket) {
    return c.json(buildEphemeralResponse("Ticket not found or expired."), 200);
  }

  if (parsed.action === "reassign") {
    const validationError = isTicketActionAllowed(ticket, parsed.action);
    if (validationError) {
      return c.json(buildEphemeralResponse(validationError), 200);
    }
    return c.json(buildReassignModal(parsed.ticketId), 200);
  }

  const validationError = isTicketActionAllowed(ticket, parsed.action);
  if (validationError) {
    return c.json(buildEphemeralResponse(validationError), 200);
  }

  const updated = await applyTicketAction(ticket, parsed.action, actor);
  await trackTicketActionForReport(updated.subreddit, parsed.action, actor.username);
  return c.json(buildUpdateMessageResponse(updated), 200);
}

async function handleModalSubmit(
  c: { json: (body: unknown, status?: number) => Response },
  interaction: DiscordInteraction
) {
  const customId = interaction.data?.custom_id;
  if (!customId?.startsWith("reassign:")) {
    return c.json(buildEphemeralResponse("Unknown modal."), 200);
  }

  const ticketId = customId.replace("reassign:", "");
  const assigneeName =
    interaction.data?.components?.[0]?.components?.[0]?.value?.trim() ?? "";

  if (!assigneeName) {
    return c.json(buildEphemeralResponse("Please enter a team member name."), 200);
  }

  const actor = getInteractionUser(interaction);
  if (!actor) {
    return c.json(buildEphemeralResponse("Unable to identify Discord user."), 200);
  }

  const ticket = await getTicket(ticketId);
  if (!ticket) {
    return c.json(buildEphemeralResponse("Ticket not found or expired."), 200);
  }

  const action: TicketAction = "reassign";
  const validationError = isTicketActionAllowed(ticket, action);
  if (validationError) {
    return c.json(buildEphemeralResponse(validationError), 200);
  }

  const updated = await applyTicketAction(ticket, action, actor, assigneeName);
  await trackTicketActionForReport(updated.subreddit, action, actor.username);
  return c.json(buildUpdateMessageResponse(updated), 200);
}
