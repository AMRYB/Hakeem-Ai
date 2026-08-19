(() => {
  const TOKEN_KEY = "ddi_token";
  let activeAudio = null;
  let activeAudioUrl = null;

  if (!document.querySelector('link[data-hakeem-production-css]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/medchat/production-fixes.css";
    link.dataset.hakeemProductionCss = "true";
    document.head.appendChild(link);
  }

  function authHeaders(extra = {}) {
    const token = localStorage.getItem(TOKEN_KEY);
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
  }

  async function jsonRequest(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: authHeaders({ "Content-Type": "application/json", ...(options.headers || {}) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
    return data;
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
    const el = document.createElement("textarea");
    el.value = value;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.append(el);
    el.select();
    document.execCommand("copy");
    el.remove();
  }

  function backendId(chat) {
    return chat?.backendSessionId || (/^[0-9a-f-]{36}$/i.test(chat?.id || "") ? chat.id : null);
  }

  const originalDeleteChat = typeof deleteChat === "function" ? deleteChat : null;
  if (originalDeleteChat) {
    deleteChat = async function persistentDeleteChat(chatId) {
      const chat = state.chats.find((item) => item.id === chatId);
      const sessionId = backendId(chat);
      if (sessionId) {
        try {
          await jsonRequest(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
        } catch (error) {
          showToast(error.message || "Could not delete conversation");
          return;
        }
      }
      originalDeleteChat(chatId);
      showToast("Conversation deleted");
    };
  }

  const originalFinishInlineRename = typeof finishInlineRename === "function" ? finishInlineRename : null;
  if (originalFinishInlineRename) {
    finishInlineRename = function persistentRename(options = {}) {
      const chatId = typeof editingChatId !== "undefined" ? editingChatId : null;
      const input = chatId ? els.conversationGroups.querySelector(`[data-rename-input="${chatId}"]`) : null;
      const nextTitle = input?.value?.trim();
      originalFinishInlineRename(options);
      if (!chatId || options.revert || !nextTitle) return;
      const chat = state.chats.find((item) => item.id === chatId);
      const sessionId = backendId(chat);
      if (!sessionId) return;
      jsonRequest(`/api/chat/sessions/${encodeURIComponent(sessionId)}/title`, {
        method: "PUT",
        body: JSON.stringify({ title: nextTitle.slice(0, 160) }),
      }).catch((error) => showToast(error.message || "Could not save conversation name"));
    };
  }

  async function shareChat(chat) {
    const sessionId = backendId(chat);
    if (!sessionId) {
      showToast("Send at least one message before sharing");
      return;
    }
    try {
      const data = await jsonRequest(`/api/chat/sessions/${encodeURIComponent(sessionId)}/share`, { method: "POST" });
      chat.shareId = data.share_id;
      chat.shareUrl = data.share_url;
      saveState();
      await copyText(data.share_url);
      showToast(`Share link copied · ID ${data.share_id}`);
    } catch (error) {
      showToast(error.message || "Could not create share link");
    }
  }

  document.addEventListener(
    "click",
    (event) => {
      const topShare = event.target.closest("#shareButton");
      const menuShare = event.target.closest('[data-menu-action="share"]');
      if (!topShare && !menuShare) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      let chat = currentChat();
      if (menuShare && typeof activeConversationMenuChatId !== "undefined" && activeConversationMenuChatId) {
        chat = state.chats.find((item) => item.id === activeConversationMenuChatId) || chat;
      }
      if (typeof closeConversationMenu === "function") closeConversationMenu();
      shareChat(chat);
    },
    true,
  );

  const clearButton = document.getElementById("clearButton");
  if (clearButton) {
    clearButton.addEventListener(
      "click",
      async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
          await jsonRequest("/api/chat/sessions", { method: "DELETE" });
          state.chats = [createBlankChat()];
          state.currentChatId = state.chats[0].id;
          saveState();
          render();
          if (typeof closeSheets === "function") closeSheets();
          showToast("All conversations cleared");
        } catch (error) {
          showToast(error.message || "Could not clear conversations");
        }
      },
      true,
    );
  }

  const accountButton = document.getElementById("changeAccountButton");
  if (accountButton) {
    accountButton.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.top.location.href = "/onboarding";
      },
      true,
    );
    accountButton.querySelector("span")?.replaceChildren("Medication profile");
  }

  if (typeof speakText === "function") {
    speakText = async function elevenLabsSpeak(text) {
      const clean = String(text || "").trim();
      if (!clean) return;

      if (activeAudio && !activeAudio.paused) {
        activeAudio.pause();
        activeAudio.currentTime = 0;
        showToast("Audio stopped");
        return;
      }

      if (activeAudioUrl) {
        URL.revokeObjectURL(activeAudioUrl);
        activeAudioUrl = null;
      }

      showToast("Generating natural voice with ElevenLabs…");
      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ text: clean }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.detail || `Voice request failed (${response.status})`);
        }
        const blob = await response.blob();
        activeAudioUrl = URL.createObjectURL(blob);
        activeAudio = new Audio(activeAudioUrl);
        activeAudio.onended = () => {
          if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
          activeAudioUrl = null;
          activeAudio = null;
        };
        await activeAudio.play();
      } catch (error) {
        showToast(error.message || "Could not generate voice");
      }
    };
  }

  document.querySelector(".thinking-mode-wrap")?.remove();
  document.querySelector("#temporaryChatButton")?.remove();
  document.querySelector(".composer-plus-wrap")?.remove();

  document.querySelectorAll(
    '[data-menu-action="group"], [data-menu-action="archive"], [data-menu-action="pin"], [data-top-menu-action="group"], [data-top-menu-action="files"], [data-top-menu-action="archive"], [data-top-menu-action="pin"]',
  ).forEach((button) => button.remove());

  const sendButton = document.getElementById("sendButton");
  if (sendButton) {
    sendButton.setAttribute("aria-label", "Send message");
    sendButton.setAttribute("title", "Send message");
  }
})();
