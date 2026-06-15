import { Hono } from "hono";
import type {
  AutomoderatorFilterComment,
  AutomoderatorFilterPost,
  CommentReport,
  CommentSubmit,
  CommentCreate,
  ModAction,
  ModMail,
  PostReport,
  PostSubmit,
  PostUpdate,
} from "@devvit/protos";
import type { TriggerResponse } from "@devvit/web/shared";
import { safeTrack } from "../lib/reporting.js";
import {
  sendModMailToWebhook,
  sendCommentFollowUpToTicket,
  sendModQueueAlertFromAutomodComment,
  sendModQueueAlertFromAutomodPost,
  sendModQueueAlertFromCommentReport,
  sendModQueueAlertFromPostReport,
  sendNewPostAlert,
  sendPostUpdateFollowUpToTicket,
  trackCommentSubmitForReport,
  trackModActionForReport,
  trackModMailForReport,
  trackModQueueForReport,
  trackPostSubmitForReport,
} from "../lib/reddit-alerts.js";
import { getErrorMessage } from "../lib/discord.js";
import { syncClosedWebhooksToWorker } from "../lib/worker-client.js";

export const triggers = new Hono();

function success(message: string): TriggerResponse {
  return { status: "success", message };
}

function error(message: string): TriggerResponse {
  return { status: "error", message };
}

triggers.post("/on-app-install", async (c) => {
  await syncClosedWebhooksToWorker();
  return c.json(success("App installed."), 200);
});

triggers.post("/on-app-upgrade", async (c) => {
  await syncClosedWebhooksToWorker();
  return c.json(success("App upgraded."), 200);
});

triggers.post("/on-mod-mail", async (c) => {
  try {
    const event = await c.req.json<ModMail>();
    await sendModMailToWebhook(event);
    await safeTrack(() => trackModMailForReport(event));
    return c.json(success("Modmail alert processed."), 200);
  } catch (err) {
    console.error("ModMail trigger error:", getErrorMessage(err));
    return c.json(error(getErrorMessage(err)), 500);
  }
});

triggers.post("/on-mod-queue", async (c) => {
  try {
    const event = await c.req.json<
      | ({ type: "PostReport" } & PostReport)
      | ({ type: "CommentReport" } & CommentReport)
      | ({ type: "AutomoderatorFilterPost" } & AutomoderatorFilterPost)
      | ({ type: "AutomoderatorFilterComment" } & AutomoderatorFilterComment)
    >();

    await safeTrack(() => trackModQueueForReport(event));

    switch (event.type) {
      case "PostReport":
        await sendModQueueAlertFromPostReport(event);
        break;
      case "CommentReport":
        await sendModQueueAlertFromCommentReport(event);
        break;
      case "AutomoderatorFilterPost":
        await sendModQueueAlertFromAutomodPost(event);
        break;
      case "AutomoderatorFilterComment":
        await sendModQueueAlertFromAutomodComment(event);
        break;
      default:
        console.error("Unhandled mod queue event type");
    }

    return c.json(success("Mod queue alert processed."), 200);
  } catch (err) {
    console.error("Mod queue trigger error:", getErrorMessage(err));
    return c.json(error(getErrorMessage(err)), 500);
  }
});

triggers.post("/on-post-submit", async (c) => {
  try {
    const event = await c.req.json<PostSubmit>();
    await sendNewPostAlert(event);
    await safeTrack(() => trackPostSubmitForReport(event));
    return c.json(success("New post alert processed."), 200);
  } catch (err) {
    console.error("PostSubmit trigger error:", getErrorMessage(err));
    return c.json(error(getErrorMessage(err)), 500);
  }
});

triggers.post("/on-comment-submit", async (c) => {
  try {
    const event = await c.req.json<CommentSubmit>();
    await sendCommentFollowUpToTicket(event);
    await safeTrack(() => trackCommentSubmitForReport(event));
    return c.json(success("Comment tracking processed."), 200);
  } catch (err) {
    console.error("CommentSubmit trigger error:", getErrorMessage(err));
    return c.json(error(getErrorMessage(err)), 500);
  }
});

triggers.post("/on-comment-create", async (c) => {
  try {
    const event = await c.req.json<CommentCreate>();
    await sendCommentFollowUpToTicket(event);
    return c.json(success("Comment follow-up processed."), 200);
  } catch (err) {
    console.error("CommentCreate trigger error:", getErrorMessage(err));
    return c.json(error(getErrorMessage(err)), 500);
  }
});

triggers.post("/on-post-update", async (c) => {
  try {
    const event = await c.req.json<PostUpdate>();
    await sendPostUpdateFollowUpToTicket(event);
    return c.json(success("Post update follow-up processed."), 200);
  } catch (err) {
    console.error("PostUpdate trigger error:", getErrorMessage(err));
    return c.json(error(getErrorMessage(err)), 500);
  }
});

triggers.post("/on-mod-action", async (c) => {
  try {
    const event = await c.req.json<ModAction>();
    await safeTrack(() => trackModActionForReport(event));
    return c.json(success("Mod action tracking processed."), 200);
  } catch (err) {
    console.error("ModAction trigger error:", getErrorMessage(err));
    return c.json(error(getErrorMessage(err)), 500);
  }
});
