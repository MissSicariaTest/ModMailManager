import { Hono } from "hono";
import { maybeSendDailyReport } from "../lib/reporting.js";
import { getErrorMessage } from "../lib/discord.js";

export const schedulerRoutes = new Hono();

schedulerRoutes.post("/daily-report", async (c) => {
  try {
    await maybeSendDailyReport();
    return c.json({ status: "success" }, 200);
  } catch (err) {
    console.error("Daily report scheduler error:", getErrorMessage(err));
    return c.json({ status: "error", message: getErrorMessage(err) }, 500);
  }
});
