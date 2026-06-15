import { settings } from "@devvit/web/server";
import type { TicketRecord } from "../../shared/types.js";
import { getErrorMessage } from "./discord.js";

export async function getWorkerConfig(): Promise<{
  url: string;
  secret: string;
} | null> {
  const url = ((await settings.get("discordInteractionsWorkerUrl")) as string | undefined)
    ?.trim()
    .replace(/\/$/, "");
  const secret = ((await settings.get("discordInteractionsWorkerSecret")) as string | undefined)?.trim();

  if (!url || !secret) {
    return null;
  }

  return { url, secret };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function registerTicketWithWorker(ticket: TicketRecord): Promise<boolean> {
  const config = await getWorkerConfig();
  if (!config) {
    console.error(
      "Discord buttons will not work until Cloudflare Worker URL and shared secret are saved in Reddit app settings."
    );
    return false;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${config.url}/api/tickets/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.secret}`,
        },
        body: JSON.stringify(ticket),
      });

      if (response.ok) {
        return true;
      }

      const body = await response.text().catch(() => "");
      console.error(
        `Worker ticket register failed (attempt ${attempt}/3): ${response.status} ${body}`
      );
    } catch (error) {
      console.error(
        `Worker ticket register error (attempt ${attempt}/3):`,
        getErrorMessage(error)
      );
    }

    if (attempt < 3) {
      await sleep(500 * attempt);
    }
  }

  return false;
}

export type WorkerReportSnapshot = {
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

export async function fetchWorkerReportSnapshot(): Promise<WorkerReportSnapshot | null> {
  const config = await getWorkerConfig();
  if (!config) {
    return null;
  }

  try {
    const response = await fetch(`${config.url}/api/report/snapshot`, {
      headers: {
        Authorization: `Bearer ${config.secret}`,
      },
    });

    if (!response.ok) {
      console.error(`Worker report fetch failed: ${response.status}`);
      return null;
    }

    return (await response.json()) as WorkerReportSnapshot;
  } catch (error) {
    console.error("Worker report fetch error:", getErrorMessage(error));
    return null;
  }
}

export async function resetWorkerReportSnapshot(): Promise<void> {
  const config = await getWorkerConfig();
  if (!config) {
    return;
  }

  try {
    const response = await fetch(`${config.url}/api/report/reset`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.secret}`,
      },
    });

    if (!response.ok) {
      console.error(`Worker report reset failed: ${response.status}`);
    }
  } catch (error) {
    console.error("Worker report reset error:", getErrorMessage(error));
  }
}
