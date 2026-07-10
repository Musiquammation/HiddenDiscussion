// ForumRoom.ts — in-RAM representation of a forum. Created when the first
// participant connects, destroyed when it becomes empty (no clients, no
// pending messages) or after 7 days without any activity.

import WebSocket from "ws";
import { getLogger } from "./Logger";
import { getForumById, getParticipantsByForum, updateLastVisit } from "./db";
import { ChatMessagePayload, ServerMessage } from "./types";

const logger = getLogger("ForumRoom");

// How long a forum may sit untouched in RAM before being garbage collected.
const FORUM_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** A message kept server-side because at least one participant was offline when it was sent. */
interface PendingMessage extends ChatMessagePayload {
  deliveredTo: Set<string>; // participant keys who already have this message
}

/** A participant that is currently connected to this forum. */
interface ConnectedParticipant {
  key: string;
  name: string;
  socket: WebSocket;
}

export class ForumRoom {
  readonly id: number;
  readonly name: string;

  /** All participants that belong to this forum, as known from the DB (key -> name). */
  private allParticipants: Map<string, string>;

  /** Currently connected participants (key -> connection). */
  readonly connected = new Map<string, ConnectedParticipant>();

  /** Keys of the participants currently flagged as typing. */
  readonly typingUsers = new Set<string>();

  /** Messages not yet acknowledged by every participant of the forum. */
  private pendingMessages = new Map<string, PendingMessage>();

  private expiryTimer: NodeJS.Timeout | null = null;
  private readonly onExpire: (forumId: number) => void;

  private constructor(
    id: number,
    name: string,
    allParticipants: Map<string, string>,
    onExpire: (forumId: number) => void
  ) {
    this.id = id;
    this.name = name;
    this.allParticipants = allParticipants;
    this.onExpire = onExpire;
    this.touch();
  }

  /** Loads a forum and its participants from the DB and builds a fresh in-RAM room. */
  static loadFromDb(forumId: number, onExpire: (forumId: number) => void): ForumRoom | null {
    const forumRow = getForumById(forumId);
    if (!forumRow) return null;

    const participantRows = getParticipantsByForum(forumId);
    const participantMap = new Map(participantRows.map((p) => [p.key, p.name]));

    logger.debug(
      `Loaded forum "${forumRow.name}" (id=${forumId}) from DB with ${participantMap.size} participant(s)`
    );
    return new ForumRoom(forumRow.id, forumRow.name, participantMap, onExpire);
  }

  hasParticipant(key: string): boolean {
    return this.allParticipants.has(key);
  }

  nameOf(key: string): string | undefined {
    return this.allParticipants.get(key);
  }

  isConnected(key: string): boolean {
    return this.connected.has(key);
  }

  /** Resets the 7-day inactivity timer. Called on every meaningful activity. */
  private touch() {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = setTimeout(() => {
      logger.info(`Forum "${this.name}" (id=${this.id}) expired after 7 days of inactivity, removing from RAM`);
      this.onExpire(this.id);
    }, FORUM_EXPIRY_MS);
    // Let a pending expiry timer not keep the process alive on its own.
    this.expiryTimer.unref?.();
  }

  /** Registers a newly authenticated participant connection. */
  addConnection(key: string, name: string, socket: WebSocket) {
    this.connected.set(key, { key, name, socket });
    logger.debug(`"${name}" is now connected to forum "${this.name}" (${this.connected.size} connected total)`);
    this.touch();
  }

  /** Removes a participant connection (on disconnect) and persists their lastVisit. */
  removeConnection(key: string) {
    this.connected.delete(key);
    this.typingUsers.delete(key);
    updateLastVisit(key, new Date());
    this.touch();
  }

  setTyping(key: string, typing: boolean) {
    if (typing) this.typingUsers.add(key);
    else this.typingUsers.delete(key);
  }

  /** Display names of currently connected participants. */
  connectedNames(): string[] {
    return [...this.connected.values()].map((c) => c.name);
  }

  /** Display names of participants currently typing. */
  typingNames(): string[] {
    return [...this.typingUsers].map((key) => this.allParticipants.get(key)).filter((n): n is string => !!n);
  }

  /** lastVisit map (name -> ISO date | null) for participants who are NOT currently connected. */
  offlineLastVisits(lastVisitByKey: Map<string, string | null>): Record<string, string | null> {
    const result: Record<string, string | null> = {};
    for (const [key, name] of this.allParticipants) {
      if (!this.connected.has(key)) {
        result[name] = lastVisitByKey.get(key) ?? null;
      }
    }
    return result;
  }

  /** Messages this participant has not received yet. */
  missedMessagesFor(key: string): ChatMessagePayload[] {
    const missed: ChatMessagePayload[] = [];
    for (const msg of this.pendingMessages.values()) {
      if (!msg.deliveredTo.has(key)) missed.push(this.toPayload(msg));
    }
    return missed;
  }

  private toPayload(msg: PendingMessage): ChatMessagePayload {
    return { id: msg.id, content: msg.content, author: msg.author, date: msg.date };
  }

  /**
   * Marks a message as delivered to a participant. If it has now reached every
   * participant of the forum, it is dropped from memory — it no longer serves any purpose.
   */
  private markDelivered(msg: PendingMessage, key: string) {
    msg.deliveredTo.add(key);
    if (msg.deliveredTo.size >= this.allParticipants.size) {
      this.pendingMessages.delete(msg.id);
      logger.debug(`Message ${msg.id} was now received by everyone, dropping it from forum "${this.name}"`);
    }
  }

  /** Marks all currently-missed messages for `key` as delivered (catch-up on connect). */
  deliverMissedMessages(key: string) {
    for (const msg of [...this.pendingMessages.values()]) {
      if (!msg.deliveredTo.has(key)) this.markDelivered(msg, key);
    }
  }

  /**
   * Broadcasts a brand-new message to every connected participant (including its
   * author), and stores it server-side only if at least one participant is offline.
   */
  broadcastMessage(id: string, content: string, authorKey: string) {
    const authorName = this.allParticipants.get(authorKey)!;
    const date = new Date().toISOString();
    const payload: ChatMessagePayload = { id, content, author: authorName, date };

    const pending: PendingMessage = { ...payload, deliveredTo: new Set() };

    for (const participant of this.connected.values()) {
      this.send(participant.socket, { type: "message", message: payload });
      pending.deliveredTo.add(participant.key);
    }

    const everyoneConnected = this.connected.size >= this.allParticipants.size;
    if (!everyoneConnected) {
      this.pendingMessages.set(id, pending);
      logger.debug(`Stored message ${id} in forum "${this.name}" (not everyone is connected yet)`);
    } else {
      logger.debug(`Message ${id} was delivered live to everyone in forum "${this.name}", nothing to store`);
    }

    this.touch();
  }

  /** Sends a presence update (connect/disconnect) to every connected participant. */
  broadcastPresence(username: string, connectedFlag: boolean) {
    this.broadcast({ type: "presence", username, connected: connectedFlag });
  }

  /** Sends a typing update to every connected participant. */
  broadcastTyping(username: string, typing: boolean) {
    this.broadcast({ type: "typing", username, typing });
  }

  private broadcast(message: ServerMessage) {
    for (const participant of this.connected.values()) {
      this.send(participant.socket, message);
    }
  }

  send(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  /** True once the room has no connected clients and no pending messages left. */
  isEmpty(): boolean {
    return this.connected.size === 0 && this.pendingMessages.size === 0;
  }

  dispose() {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
  }
}
