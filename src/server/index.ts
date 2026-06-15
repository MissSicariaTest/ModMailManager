import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createServer, getServerPort } from "@devvit/web/server";
import { triggers } from "./routes/triggers.js";
import { schedulerRoutes } from "./routes/scheduler.js";
import { discordRoutes } from "./routes/discord.js";

const app = new Hono();
const internal = new Hono();

internal.route("/triggers", triggers);
internal.route("/scheduler", schedulerRoutes);

app.route("/internal", internal);
app.route("/api/discord", discordRoutes);

app.get("/api/health", (c) => c.json({ status: "ok" }));

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
