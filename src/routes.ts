// routes.ts — the small HTTP API used to create forums and to resolve a
// participant key into forum info before opening a websocket.

import { Router } from "express";
import { getLogger } from "./Logger";
import { createForum, getParticipantByKey, getForumById } from "./db";

const logger = getLogger("ROUTES");
export const router = Router();

router.post("/forum", (req, res) => {
  const { name, participants } = req.body ?? {};

  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Missing forum name" });
  }
  if (
    !Array.isArray(participants) ||
    participants.length === 0 ||
    !participants.every((p) => typeof p === "string" && p.trim())
  ) {
    return res.status(400).json({ error: "Missing or invalid participants list" });
  }

  logger.info(`Creating forum "${name}" with participants: ${participants.join(", ")}`);

  try {
    const { participants: created } = createForum(name, participants);
    res.json({ ids: created.map((p) => ({ username: p.name, key: p.key })) });
  } catch (err: any) {
    logger.error(`Failed to create forum "${name}": ${err.message}`);
    res.status(500).json({ error: "Could not create forum" });
  }
});

router.get("/forum/from-participant", (req, res) => {
  // Accept the key from the JSON body (as specified) or from a query string,
  // since GET requests with a body are not universally well supported.
  const key = (req.body?.key as string | undefined) ?? (req.query.key as string | undefined);

  if (!key) {
    return res.status(400).json({ error: "Missing key" });
  }

  logger.debug(`Looking up forum for participant key ${key}`);
  const participant = getParticipantByKey(key);
  if (!participant) {
    logger.warn(`Unknown participant key ${key}`);
    return res.status(404).json({ error: "Unknown key" });
  }

  const forum = getForumById(participant.forumId);
  if (!forum) {
    logger.error(`Participant ${key} references a missing forum ${participant.forumId}`);
    return res.status(404).json({ error: "Forum not found" });
  }

  // "username" is an additive field on top of the spec'd response shape — handy
  // for the client, which otherwise has no way to know its own display name.
  res.json({ name: forum.name, username: participant.name });
});
