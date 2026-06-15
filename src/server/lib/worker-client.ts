import { settings } from "@devvit/web/server";
import type { TicketRecord } from "../../shared/types.js";
import { getErrorMessage } from "./discord.js";

export async function getWorkerConfig(): Promise<{
  url: string;
  secret: string;
} | null> {
  const url = ((await settings.get("discordInteractionsWorkerUrl")) as string | undefined)?.replace(
    /\/$/,
    ""
  );
  const secret = (await settings.get("discordInteractionsWorkerSecret")) as string | undefined;

  if (!url || !secret) {
    return null;
  }

  return { url, secret };
}

export async function registerTicketWithWorker(ticket: TicketRecord): Promise<boolean> {
  const config = await getWorkerConfig();
  if (!config) {
    console.error(
      "Discord buttons will not work until Cloudflare Worker URL and shared secret are saved in app settings."
    );
    return false;
  }

  try {
    const response = await fetch(`${config.url}/api/tickets/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.secret}`,
      },
      body: JSON.stringify(ticket),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`Worker ticket register failed: ${response.status} ${body}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Worker ticket register error:", getErrorMessage(error));
    return false;
  }
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
