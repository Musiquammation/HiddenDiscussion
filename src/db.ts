// db.ts — sqlite persistence layer. Only the Forum and Participant tables live
// here; everything else (connected sockets, typing state, pending messages)
// stays in RAM (see ForumRoom.ts).

import Database from "better-sqlite3";
import crypto from "crypto";
import { getLogger } from "./Logger";
import { ForumRow, ParticipantRow } from "./types";

const logger = getLogger("DATABASE");

const dbFile = process.env.DB_FILE;
if (!dbFile) {
  throw new Error("The DB_FILE environment variable must be set to the sqlite file path");
}

logger.info(`Opening database at "${dbFile}"`);
export const db = new Database(dbFile);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Create the schema if it does not exist yet.
db.exec(`
  CREATE TABLE IF NOT EXISTS Forum (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS Participant (
    key TEXT PRIMARY KEY,
    forumId INTEGER NOT NULL,
    name TEXT NOT NULL,
    lastVisit TEXT,
    UNIQUE(forumId, name),
    FOREIGN KEY (forumId) REFERENCES Forum(id)
  );
`);

logger.debug("Schema check complete");

/** Generates a random 16-character hex key (8 random bytes). */
function generateKey(): string {
  return crypto.randomBytes(8).toString("hex");
}

/** Creates a forum together with all of its participants in a single transaction. */
export function createForum(
  name: string,
  participantNames: string[]
): { forum: ForumRow; participants: ParticipantRow[] } {
  const insertForum = db.prepare("INSERT INTO Forum (name) VALUES (?)");
  const insertParticipant = db.prepare(
    "INSERT INTO Participant (key, forumId, name, lastVisit) VALUES (?, ?, ?, NULL)"
  );

  const run = db.transaction((forumName: string, names: string[]) => {
    const forumInfo = insertForum.run(forumName);
    const forumId = forumInfo.lastInsertRowid as number;

    const participants: ParticipantRow[] = names.map((participantName) => {
      const key = generateKey();
      insertParticipant.run(key, forumId, participantName);
      return { key, forumId, name: participantName, lastVisit: null };
    });

    return { forum: { id: forumId, name: forumName }, participants };
  });

  const result = run(name, participantNames);
  logger.info(
    `Created forum "${name}" (id=${result.forum.id}) with ${participantNames.length} participant(s): ${participantNames.join(", ")}`
  );
  return result;
}

export function getParticipantByKey(key: string): ParticipantRow | undefined {
  const row = db.prepare("SELECT * FROM Participant WHERE key = ?").get(key) as ParticipantRow | undefined;
  return row;
}

export function getForumById(id: number): ForumRow | undefined {
  const row = db.prepare("SELECT * FROM Forum WHERE id = ?").get(id) as ForumRow | undefined;
  return row;
}

export function getParticipantsByForum(forumId: number): ParticipantRow[] {
  return db.prepare("SELECT * FROM Participant WHERE forumId = ?").all(forumId) as ParticipantRow[];
}

export function updateLastVisit(key: string, date: Date): void {
  db.prepare("UPDATE Participant SET lastVisit = ? WHERE key = ?").run(date.toISOString(), key);
  logger.debug(`Updated lastVisit for participant ${key} to ${date.toISOString()}`);
}
