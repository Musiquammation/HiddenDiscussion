// types.ts — shared type definitions used across the server.

// ----- Database row shapes -----

export interface ForumRow {
  id: number;
  name: string;
}

export interface ParticipantRow {
  key: string;
  forumId: number;
  name: string;
  lastVisit: string | null; // ISO date string, or null if the participant never disconnected yet
}

// ----- WebSocket protocol: messages sent FROM the client TO the server -----

export type ClientMessage =
  | { type: "auth"; key: string }
  | { type: "message"; id: string; content: string }
  | { type: "typing"; typing: boolean };

// ----- WebSocket protocol: messages sent FROM the server TO the client -----

export interface ChatMessagePayload {
  id: string;
  content: string;
  author: string; // display name only, the key is never sent to clients
  date: string; // ISO date string, server time
}

export type ServerMessage =
  | {
      type: "authOk";
      forumName: string;
      // The client's own display name — handy so it never has to remember it itself.
      username: string;
      missedMessages: ChatMessagePayload[];
      typingUsers: string[];
      connectedUsers: string[];
      participants: string[];
      connections: ConnectionEvent[]
    }
  | { type: "authError"; reason: string }
  | { type: "presence"; username: string; connected: boolean }
  | { type: "message"; message: ChatMessagePayload }
  | { type: "typing"; username: string; typing: boolean };


export interface ConnectionEvent {
  id: string;
  participant: string;
  date: string; // ISO
  event: "joined" | "left";
}