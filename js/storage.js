// storage.js — wraps localStorage access for everything the client needs to
// remember between page loads: the forums the user has joined, and each
// forum's confirmed messages.

window.Storage = (function () {
  const FORUMS_KEY = "chat.registeredForums";

  function messagesKey(participantKey) {
    return `chat.messages.${participantKey}`;
  }

  // ---- Registered forums: forums actually joined with a participant key ----

  function getRegisteredForums() {
    const raw = localStorage.getItem(FORUMS_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  function saveRegisteredForum(entry) {
    // entry = { key, username, forumName }
    const forums = getRegisteredForums();
    const existingIndex = forums.findIndex((f) => f.key === entry.key);
    if (existingIndex >= 0) {
      forums[existingIndex] = entry;
    } else {
      forums.push(entry);
    }
    localStorage.setItem(FORUMS_KEY, JSON.stringify(forums));
  }

  // Removes a forum from the local "joined forums" list, along with its
  // stored message/history so nothing orphaned is left behind.
  function removeRegisteredForum(key) {
    const forums = getRegisteredForums().filter((f) => f.key !== key);
    localStorage.setItem(FORUMS_KEY, JSON.stringify(forums));
    localStorage.removeItem(messagesKey(key));
  }

  // ---- Messages, stored per participant key (i.e. per forum membership) ----
  // Only messages CONFIRMED by the server (received back over the socket) are
  // ever written here — a message the user just hit "send" on is not added
  // until its echo comes back.

  function getMessages(participantKey) {
    const raw = localStorage.getItem(messagesKey(participantKey));
    return raw ? JSON.parse(raw) : [];
  }

  function saveMessages(participantKey, messages) {
    localStorage.setItem(messagesKey(participantKey), JSON.stringify(messages));
  }

  function addMessage(participantKey, message) {
    const messages = getMessages(participantKey);
    if (messages.some((m) => m.id === message.id)) return; // already stored, ignore duplicate
    messages.push(message);
    messages.sort((a, b) => new Date(a.date) - new Date(b.date));
    saveMessages(participantKey, messages);
  }

  // A "connected"/"disconnected" notice. Stored in the same array as chat
  // messages (tagged with type: "system") so it replays in order next time
  // the conversation is reopened, instead of only living in the DOM.
  function addSystemNote(participantKey, participant, action) {
    const entries = getMessages(participantKey);
    const note = {
      type: "system",
      id: `sys-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      participant,
      action,
      date: new Date().toISOString(),
    };
    entries.push(note);
    entries.sort((a, b) => new Date(a.date) - new Date(b.date));
    saveMessages(participantKey, entries); // ou Storage.saveMessages(...)
    return note;
  }

  return {
    getRegisteredForums,
    saveRegisteredForum,
    removeRegisteredForum,
    getMessages,
    saveMessages,
    addMessage,
    addSystemNote,
  };
})();
