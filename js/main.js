// main.js — small router that toggles between the "home" and "chat" views.

window.Main = (function () {
  function showView(id) {
    document.querySelectorAll(".view").forEach((el) => el.classList.remove("active"));
    document.getElementById(id).classList.add("active");
  }

  function openChat(forumEntry) {
    showView("view-chat");
    Chat.open(forumEntry);
  }

  function goHome() {
    Chat.close();
    Home.render();
    showView("view-home");
  }

  function init() {
    Home.init();
    Chat.init();
    showView("view-home");
  }

  return { init, openChat, goHome, showView };
})();

document.addEventListener("DOMContentLoaded", () => Main.init());
