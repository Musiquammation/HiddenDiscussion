// home.js — drives the "home" screen (forum list + entry points) and the
// "create forum" screen. Joining a forum only needs a native prompt().

window.Home = (function () {
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function renderRegisteredForums() {
    const list = document.getElementById("forum-list");
    list.innerHTML = "";
    const forums = Storage.getRegisteredForums();

    if (forums.length === 0) {
      list.innerHTML = '<p class="empty">No forum yet — create or join one above.</p>';
      return;
    }

    for (const forum of forums) {
      const item = document.createElement("div");
      item.className = "forum-item";

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "forum-item-main";
      // Plain participant name, no "as " prefix.
      openButton.innerHTML = `<span class="forum-item-name">${escapeHtml(forum.forumName)}</span>
                               <span class="forum-item-user">${escapeHtml(forum.username)}</span>`;
      openButton.addEventListener("click", () => Main.openChat(forum));

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "forum-item-delete";
      deleteButton.title = "Remove this forum";
      deleteButton.textContent = "−";
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (confirm(`Remove "${forum.forumName}" (${forum.username}) from this device?`)) {
          Storage.removeRegisteredForum(forum.key);
          renderRegisteredForums();
        }
      });

      item.appendChild(openButton);
      item.appendChild(deleteButton);
      list.appendChild(item);
    }
  }

  // ---- Create forum (its own view) ----

  function addParticipantField() {
    const container = document.getElementById("participant-fields");
    const row = document.createElement("div");
    row.className = "participant-row";
    row.innerHTML = `<input type="text" class="participant-name" placeholder="Participant name" required />
                      <button type="button" class="remove-participant" title="Remove">&times;</button>`;
    row.querySelector(".remove-participant").addEventListener("click", () => row.remove());
    container.appendChild(row);
  }

  async function handleCreateForum(event) {
    event.preventDefault();
    const name = document.getElementById("create-forum-name").value.trim();
    const names = [...document.querySelectorAll(".participant-name")]
      .map((input) => input.value.trim())
      .filter(Boolean);

    if (!name || names.length === 0) {
      alert("Please provide a forum name and at least one participant.");
      return;
    }

    try {
      const result = await Api.createForum(name, names);
      showCreatedKeys(name, result.ids);
      document.getElementById("create-forum-form").reset();
      document.getElementById("participant-fields").innerHTML = "";
      addParticipantField();
    } catch (err) {
      alert("Failed to create the forum: " + err.message);
    }
  }

  // The generated keys panel is purely transient UI: it is never written to
  // localStorage or kept in any persistent app state, only shown once so the
  // creator can copy the keys down and hand them out.
  function showCreatedKeys(forumName, ids) {
    const panel = document.getElementById("created-keys-panel");
    const list = document.getElementById("created-keys-list");
    list.innerHTML = "";

    for (const { username, key } of ids) {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${escapeHtml(username)}</strong>: <code>${escapeHtml(key)}</code>`;
      list.appendChild(li);
    }

    document.getElementById("created-keys-title").textContent = `Keys for "${forumName}"`;
    panel.classList.remove("hidden");
  }

  function openCreateForumView() {
    document.getElementById("created-keys-panel").classList.add("hidden");
    document.getElementById("create-forum-form").reset();
    document.getElementById("participant-fields").innerHTML = "";
    addParticipantField();
    Main.showView("view-create-forum");
  }

  // ---- Join forum: just a native prompt() for the key ----

  async function handleJoinForum() {
    const key = (prompt("Participant key:") || "").trim();
    if (!key) return;

    try {
      const { name, username } = await Api.getForumFromParticipant(key);
      const entry = { key, username, forumName: name };
      Storage.saveRegisteredForum(entry);
      renderRegisteredForums();
      Main.openChat(entry);
    } catch (err) {
      alert("Invalid participant key.");
    }
  }

  function init() {
    document.getElementById("open-create-forum").addEventListener("click", openCreateForumView);
    document.getElementById("back-from-create").addEventListener("click", () => Main.showView("view-home"));
    document.getElementById("open-join-forum").addEventListener("click", handleJoinForum);

    document.getElementById("create-forum-form").addEventListener("submit", handleCreateForum);
    document.getElementById("add-participant").addEventListener("click", addParticipantField);
    document.getElementById("close-created-keys").addEventListener("click", () => {
      Main.showView("view-home");
      renderRegisteredForums();
    });

    renderRegisteredForums();
  }

  return { init, render: renderRegisteredForums };
})();
