import { describe, expect, it } from "vitest";
import {
  buildTicketButtons,
  buildTicketEmbed,
  buildUpdateMessageResponse,
  buildWebhookRequestUrl,
  messageHasInteractiveButtons,
  parseTicketCustomId,
} from "./discord.js";
import type { TicketRecord } from "../../shared/types.js";

function createTicket(overrides: Partial<TicketRecord> = {}): TicketRecord {
  return {
    id: "t_test123",
    source: "modmail",
    subreddit: "spectrum",
    status: "open",
    webhookId: "1",
    webhookToken: "token",
    messageId: "msg1",
    channelId: "chan1",
    baseEmbed: {
      title: "Test modmail",
      fields: [{ name: "Subreddit", value: "r/test", inline: true }],
      color: 0x005fff,
    },
    baseColor: 0x005fff,
    actionLog: [],
    createdAt: "2026-06-12T12:00:00.000Z",
    updatedAt: "2026-06-12T12:00:00.000Z",
    ...overrides,
  };
}

describe("ticket buttons", () => {
  it("includes all six ticket action buttons on every alert", () => {
    const rows = buildTicketButtons("t_test123", "open");
    const labels = rows.flatMap((row) => row.components.map((button) => button.label));

    expect(labels).toEqual([
      "Claim",
      "Close",
      "Reopen",
      "Resolved",
      "Unresolved",
      "Reassign",
    ]);
  });

  it("disables claim after a ticket is claimed", () => {
    const rows = buildTicketButtons("t_test123", "claimed");
    const claim = rows[0].components.find((button) => button.label === "Claim");

    expect(claim?.disabled).toBe(true);
  });

  it("parses button custom ids", () => {
    expect(parseTicketCustomId("ticket:claim:t_test123")).toEqual({
      action: "claim",
      ticketId: "t_test123",
    });
  });
});

describe("ticket embed updates", () => {
  it("adds status, assignee, and action log fields to the embed", () => {
    const embed = buildTicketEmbed(
      createTicket({
        status: "claimed",
        assignedTo: "ModOne",
        actionLog: [
          {
            action: "claim",
            discordUserId: "1",
            discordUsername: "ModOne",
            timestamp: "2026-06-12T12:05:00.000Z",
          },
        ],
      })
    );

    const fieldNames = embed.fields?.map((field) => field.name) ?? [];
    expect(fieldNames).toContain("Status");
    expect(fieldNames).toContain("Assigned To");
    expect(fieldNames).toContain("Claimed");
    expect(embed.fields?.find((field) => field.name === "Assigned To")?.value).toBe("ModOne");
  });

  it("returns an in-place Discord interaction update payload", () => {
    const response = buildUpdateMessageResponse(
      createTicket({
        status: "resolved",
        actionLog: [
          {
            action: "resolved",
            discordUserId: "2",
            discordUsername: "ModTwo",
            timestamp: "2026-06-12T12:10:00.000Z",
          },
        ],
      })
    ) as { type: number; data: { embeds: unknown[]; components: unknown[] } };

    expect(response.type).toBe(7);
    expect(response.data.embeds).toHaveLength(1);
    expect(response.data.components).toHaveLength(2);
  });
});

describe("webhook delivery", () => {
  it("requests interactive components when sending buttons", () => {
    expect(
      buildWebhookRequestUrl("https://discord.com/api/webhooks/1/token", {
        wait: true,
        withComponents: true,
      })
    ).toBe("https://discord.com/api/webhooks/1/token?wait=true&with_components=true");
  });

  it("detects interactive buttons on webhook responses", () => {
    expect(
      messageHasInteractiveButtons({
        id: "1",
        channel_id: "2",
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 1,
                label: "Claim",
                custom_id: "ticket:claim:t_test123",
              },
            ],
          },
        ],
      })
    ).toBe(true);
  });
});
