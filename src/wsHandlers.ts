// wsHandlers.ts — everything that happens on a websocket connection: auth,
// sending/receiving messages, typing notifications, and disconnect handling.

import WebSocket from "ws";
import { IncomingMessage } from "http";
import { getLogger } from "./Logger";
import { getParticipantByKey, getParticipantsByForum } from "./db";
import { forumRegistry } from "./ForumRegistry";
import { ForumRoom } from "./ForumRoom";
import { ClientMessage, ServerMessage } from "./types";

const logger = getLogger("WS");

// Tracks the authenticated identity attached to each open socket.
interface SocketState {
  authenticated: boolean;
  key?: string;
  forumId?: number;
}

export function handleConnection(socket: WebSocket, req: IncomingMessage) {
  const remote = req.socket.remoteAddress;
  logger.info(`New websocket connection from ${remote}`);

  const state: SocketState = { authenticated: false };

  socket.on("message", (raw) => {
    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      logger.warn(`Received non-JSON payload from ${remote}, ignoring`);
      return;
    }

    logger.debug(`Received "${parsed.type}" from ${remote}`);

    if (parsed.type === "auth") {
      handleAuth(socket, state, parsed.key);
      return;
    }

    if (!state.authenticated || !state.key || state.forumId === undefined) {
      logger.warn(`Ignoring "${parsed.type}" from an unauthenticated socket (${remote})`);
      return;
    }

    const room = forumRegistry.getOrLoad(state.forumId);
    if (!room) {
      logger.error(`Forum ${state.forumId} unexpectedly missing while handling a message from ${remote}`);
      return;
    }

    if (parsed.type === "message") {
      handleClientMessage(room, state.key, parsed.id, parsed.content);
    } else if (parsed.type === "typing") {
      handleTyping(room, state.key, parsed.typing);
    }
  });

  socket.on("close", () => {
    handleDisconnect(state, remote);
  });

  socket.on("error", (err) => {
    logger.error(`Socket error from ${remote}: ${err.message}`);
  });
}

function handleAuth(socket: WebSocket, state: SocketState, key: string) {
  logger.debug(`Authenticating socket with key ${key}`);

  const participant = getParticipantByKey(key);
  if (!participant) {
    logger.warn(`Auth failed: unknown key ${key}`);
    send(socket, { type: "authError", reason: "Unknown key" });
    socket.close();
    return;
  }

  const room = forumRegistry.getOrLoad(participant.forumId);
  if (!room) {
    logger.error(`Auth failed: forum ${participant.forumId} not found for key ${key}`);
    send(socket, { type: "authError", reason: "Forum not found" });
    socket.close();
    return;
  }

  if (room.isConnected(key)) {
    logger.warn(
      `Rejecting new connection: participant "${participant.name}" is already connected to forum "${room.name}"`
    );
    send(socket, { type: "authError", reason: "This participant is already connected elsewhere" });
    socket.close();
    return;
  }

  room.addConnection(key, participant.name, socket);
  state.authenticated = true;
  state.key = key;
  state.forumId = room.id;

  const missedMessages = room.missedMessagesFor(key);
  room.deliverMissedMessages(key);

  const connections = room.missedConnectionsFor(key);
  room.deliverMissedConnections(key);

  send(socket, {
    type: "authOk",
    forumName: room.name,
    username: participant.name,
    missedMessages,
    connections,
    typingUsers: room.typingNames(),
    connectedUsers: room.connectedNames(),
  });

  logger.info(`Participant "${participant.name}" connected to forum "${room.name}" (id=${room.id})`);
  room.broadcastPresence(participant.name, true);
}

function handleClientMessage(room: ForumRoom, authorKey: string, id: string, content: string) {
  const authorName = room.nameOf(authorKey);
  logger.info(`"${authorName}" sent message ${id} in forum "${room.name}"`);
  room.broadcastMessage(id, content, authorKey);
}

function handleTyping(room: ForumRoom, key: string, typing: boolean) {
  const name = room.nameOf(key);
  logger.debug(`"${name}" is now ${typing ? "typing" : "not typing"} in forum "${room.name}"`);
  room.setTyping(key, typing);
  room.broadcastTyping(name!, typing);
}

function handleDisconnect(state: SocketState, remote?: string) {
  if (!state.authenticated || !state.key || state.forumId === undefined) {
    logger.info(`Unauthenticated socket ${remote} closed`);
    return;
  }

  const room = forumRegistry.getOrLoad(state.forumId);
  if (!room) return;

  const name = room.nameOf(state.key);
  room.removeConnection(state.key);
  logger.info(`Participant "${name}" disconnected from forum "${room.name}"`);
  room.broadcastPresence(name!, false);
  room.broadcastTyping(name!, false);

  forumRegistry.removeIfEmpty(room.id);
}

function send(socket: WebSocket, message: ServerMessage) {
  socket.send(JSON.stringify(message));
}
