// api.js — thin wrapper around the HTTP API exposed by the server.

window.Api = (function () {
  async function createForum(name, participants) {
    const res = await fetch(API_URL + "/forum", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, participants }),
    });
    if (!res.ok) throw new Error("Could not create the forum");
    return res.json(); // { ids: [{ username, key }, ...] }
  }

  async function getForumFromParticipant(key) {
    const res = await fetch(`${API_URL}/forum/from-participant?key=${encodeURIComponent(key)}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error("Unknown participant key");
    return res.json(); // { name, username }
  }

  function wsUrl() {
    return SOCKET_URL + "/ws";
  }

  return { createForum, getForumFromParticipant, wsUrl };
})();
