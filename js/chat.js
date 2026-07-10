// chat.js — drives the conversation screen: websocket connection, message
// rendering, typing indicators, the connected-users list, and the divider
// between messages that existed before this session and new ones.

window.Chat = (function () {
  let socket = null;
  let forumEntry = null; // { key, username, forumName }
  let entries = []; // messages + system notes for this forum, mirrors localStorage
  const pendingOutgoing = new Map(); // id -> bubble element, awaiting server echo
  const currentlyTyping = new Set(); // display names currently typing (excluding self)

  // Ids that were already in storage when this chat session was opened — used
  // to place a single divider between "old" and "new" content after connecting.
  let oldIds = new Set();
  let dividerPlaced = false;

  const connectedUsers = new Set(); // display names currently connected, incl. self

  let typingTimeout = null;
  let iAmTyping = false;

  function open(entry) {
    forumEntry = entry;
    entries = Storage.getMessages(entry.key);
    oldIds = new Set(entries.map((e) => e.id));
    dividerPlaced = false;
    pendingOutgoing.clear();
    currentlyTyping.clear();
    connectedUsers.clear();

    document.getElementById("chat-title").textContent = entry.forumName;
    document.getElementById("chat-subtitle").textContent = `Connected as ${entry.username}`;
    document.getElementById("typing-indicator").textContent = "";
    renderConnectedUsers();
    renderMessages();

    connect();
  }

  function close() {
    if (socket) {
      socket.onclose = null;
      socket.close();
      socket = null;
    }
  }

  function connect() {
    socket = new WebSocket(Api.wsUrl());

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "auth", key: forumEntry.key }));
    });

    socket.addEventListener("message", (event) => {
      handleServerMessage(JSON.parse(event.data));
    });
  }

  function handleServerMessage(data) {
    switch (data.type) {
      case "authOk":
        return handleAuthOk(data);
      case "authError":
        return handleAuthError(data);
      case "presence":
        return handlePresence(data);
      case "message":
        return handleIncomingMessage(data.message);
      case "typing":
        return handleTyping(data);
    }
  }

  function handleAuthOk(data) {
    // 1. Update the list of currently connected users
    connectedUsers.clear();
    for (const name of data.connectedUsers) connectedUsers.add(name);
    renderConnectedUsers();

    // 2. Process the connection/disconnection history
    if (data.connections) {
      for (const conn of data.connections) {
        const action = conn.event === "left" ? "disconnected" : "connected";

        // Use Storage.addMessage directly to preserve the server-generated id and timestamp
        Storage.addMessage(forumEntry.key, {
          id: conn.id,
          type: "system",
          text: `${conn.participant} ${action}`,
          date: conn.date
        });
      }
    }

    // 3. Process missed messages
    for (const missed of data.missedMessages) {
      Storage.addMessage(forumEntry.key, missed);
    }

    // 4. Load the complete message history and render it
    entries = Storage.getMessages(forumEntry.key);
    renderMessages();

    // 5. Update the typing indicators
    currentlyTyping.clear();
    for (const name of data.typingUsers) {
      if (name !== forumEntry.username) currentlyTyping.add(name);
    }
    renderTypingUsers();
  }

  function handleAuthError(data) {
    alert("Could not join the conversation: " + data.reason);
  }

  function handlePresence(data) {
    if (data.connected) connectedUsers.add(data.username);
    else connectedUsers.delete(data.username);
    renderConnectedUsers();

    if (!data.connected) currentlyTyping.delete(data.username);
    renderTypingUsers();

    const note = Storage.addSystemNote(
      forumEntry.key,
      `${data.username} ${data.connected ? "connected" : "disconnected"}`
    );
    appendSystemNote(note);
  }

  function handleIncomingMessage(message) {
    if (message.author === forumEntry.username && pendingOutgoing.has(message.id)) {
      // Echo of a message we sent: stop waiting and persist it now.
      const bubble = pendingOutgoing.get(message.id);
      bubble.classList.remove("waiting");
      pendingOutgoing.delete(message.id);
      Storage.addMessage(forumEntry.key, message);
      entries = Storage.getMessages(forumEntry.key);
    } else {
      Storage.addMessage(forumEntry.key, message);
      entries = Storage.getMessages(forumEntry.key);
      renderMessages();
    }
  }

  function handleTyping(data) {
    if (data.username === forumEntry.username) return;
    if (data.typing) currentlyTyping.add(data.username);
    else currentlyTyping.delete(data.username);
    renderTypingUsers();
  }

  // ---- Sending ----

  function sendMessage(content) {
    if (!content.trim() || !socket || socket.readyState !== WebSocket.OPEN) return;

    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    socket.send(JSON.stringify({ type: "message", id, content }));

    // Render a waiting bubble right away; it is NOT written to storage yet —
    // that only happens once the server echoes it back to us.
    const bubble = renderBubble({ id, content, author: forumEntry.username, date: new Date().toISOString() }, true);
    bubble.classList.add("waiting");
    pendingOutgoing.set(id, bubble);

    setTyping(false);
  }

  function setTyping(typing) {
    if (typing === iAmTyping) return;
    iAmTyping = typing;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "typing", typing }));
    }
  }

  function handleTypingInput() {
    setTyping(true);
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => setTyping(false), 2000);
  }

  // ---- Rendering ----

  function renderConnectedUsers() {
    document.getElementById("connected-users").textContent = [...connectedUsers].sort().join(", ");
  }

  function renderMessages() {
    const container = document.getElementById("messages");
    container.innerHTML = "";
    dividerPlaced = false;

    for (const entry of entries) {
      maybeInsertDivider(entry.id);
      if (entry.type === "system") {
        appendSystemNote(entry);
      } else {
        renderBubble(entry, entry.author === forumEntry.username);
      }
    }
    container.scrollTop = container.scrollHeight;
  }

  // Inserts a single divider right before the first entry that wasn't already
  // in storage when this chat session was opened.
  function maybeInsertDivider(entryId) {
    if (dividerPlaced) return;
    if (oldIds.size === 0) return; // nothing "old" to separate from
    if (oldIds.has(entryId)) return; // still an old entry
    const container = document.getElementById("messages");
    const divider = document.createElement("div");
    divider.className = "divider";
    divider.innerHTML = "<span>New messages</span>";
    container.appendChild(divider);
    dividerPlaced = true;
  }

  function formatTime(dateIso) {
    return new Date(dateIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function renderBubble(message, isMine) {
    const container = document.getElementById("messages");
    const bubble = document.createElement("div");
    bubble.className = "bubble " + (isMine ? "mine" : "theirs");
    bubble.dataset.id = message.id;
    bubble.dataset.date = message.date;
    bubble.innerHTML = `
      ${isMine ? "" : `<div class="bubble-author">${escapeHtml(message.author)}</div>`}
      <div class="bubble-content">${escapeHtml(message.content)}</div>
      <div class="bubble-time">${formatTime(message.date)}</div>
    `;
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
    return bubble;
  }

  function renderTypingUsers() {
    const el = document.getElementById("typing-indicator");
    const names = [...currentlyTyping];
    el.textContent = names.length > 0 ? `${names.join(", ")} typing…` : "";
  }

  function appendSystemNote(note) {
    const container = document.getElementById("messages");
    const el = document.createElement("div");
    el.className = "system-note";
    el.dataset.id = note.id;
    el.textContent = `${note.text} · ${formatTime(note.date)}`;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function init() {
    document.getElementById("message-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.getElementById("message-input");
      sendMessage(input.value);
      input.value = "";
    });
    document.getElementById("message-input").addEventListener("input", handleTypingInput);
    document.getElementById("back-to-home").addEventListener("click", () => Main.goHome());
  }

  return { init, open, close };
})();
