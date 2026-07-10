// ForumRegistry.ts — the single source of truth for which forums currently
// live in RAM. Lazily loads forums from the DB on first use, and evicts them
// either when they become empty or after 7 days of inactivity (ForumRoom's job).

import { getLogger } from "./Logger";
import { ForumRoom } from "./ForumRoom";

const logger = getLogger("ForumRegistry");

class ForumRegistry {
  private forums = new Map<number, ForumRoom>();

  /** Returns the in-RAM room for a forum, loading it from the DB if it isn't loaded yet. */
  getOrLoad(forumId: number): ForumRoom | null {
    const cached = this.forums.get(forumId);
    if (cached) return cached;

    const room = ForumRoom.loadFromDb(forumId, (id) => this.remove(id));
    if (!room) {
      logger.warn(`Tried to load unknown forum id=${forumId}`);
      return null;
    }

    this.forums.set(forumId, room);
    logger.info(`Forum "${room.name}" (id=${forumId}) is now active in RAM`);
    return room;
  }

  /** Removes a forum from RAM if it has no connected clients and no pending messages. */
  removeIfEmpty(forumId: number) {
    const room = this.forums.get(forumId);
    if (room && room.isEmpty()) {
      logger.debug(`Forum "${room.name}" (id=${forumId}) is now empty, removing it from RAM`);
      this.remove(forumId);
    }
  }

  remove(forumId: number) {
    const room = this.forums.get(forumId);
    if (!room) return;
    room.dispose();
    this.forums.delete(forumId);
    logger.info(`Forum "${room.name}" (id=${forumId}) removed from RAM`);
  }
}

export const forumRegistry = new ForumRegistry();
