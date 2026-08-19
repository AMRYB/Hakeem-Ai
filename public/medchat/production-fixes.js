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

  const medicationPrompts = [
    {
      icon: "pill",
      label: "Active ingredient in Panadol?",
      prompt: "What is the active ingredient in Panadol, and what does it do?",
    },
    {
      icon: "scale",
      label: "Panadol vs paracetamol?",
      prompt: "What is the difference between Panadol and paracetamol?",
    },
    {
      icon: "shield-alert",
      label: "Aspirin with warfarin?",
      prompt: "Can I take aspirin with warfarin? What interaction should I know about?",
    },
    {
      icon: "refresh-cw",
      label: "Can these medicines interact?",
      prompt: "How can I tell if one medicine may interact with another medicine I am taking?",
    },
  ];

  function applyMedicationStarterUi() {
    const chat = typeof currentChat === "function" ? currentChat() : null;
    const isEmpty = !chat?.messages?.length;

    if (typeof els !== "undefined") {
      if (els.promptInput) {
        els.promptInput.placeholder = isEmpty ? "Message Hakeem" : "Continue...";
        els.promptInput.setAttribute("dir", "ltr");
        els.promptInput.setAttribute("lang", "en");
      }
      if (els.emptyState) {
        els.emptyState.hidden = !isEmpty;
        const heading = els.emptyState.querySelector("h1");
        if (heading) heading.textContent = "How are you feeling today?";
      }
      if (els.chatView) {
        els.chatView.classList.toggle("is-empty", isEmpty);
        els.chatView.classList.remove("has-draft");
      }
      if (els.suggestionGrid) {
        const buttons = Array.from(els.suggestionGrid.querySelectorAll("button"));
        medicationPrompts.forEach((item, index) => {
          const button = buttons[index];
          if (!button) return;
          button.dataset.prompt = item.prompt;
          button.innerHTML = `<i data-lucide="${item.icon}"></i><span>${item.label}</span>`;
        });
      }
    }

    document.documentElement.lang = "en";
    document.documentElement.dir = "ltr";
    document.body.dir = "ltr";

    const send = document.getElementById("sendButton");
    if (send) {
      send.setAttribute("aria-label", "Send message");
      send.setAttribute("title", "Send message");
    }

    if (window.lucide) window.lucide.createIcons();
  }

  if (typeof createBlankChat === "function") {
    const originalCreateBlankChat = createBlankChat;
    createBlankChat = function englishBlankChat() {
      const chat = originalCreateBlankChat();
      chat.title = "New chat";
      return chat;
    };
  }

  if (typeof syncChatViewState === "function") {
    const originalSyncChatViewState = syncChatViewState;
    syncChatViewState = function stableEnglishChatViewState() {
      originalSyncChatViewState();
      applyMedicationStarterUi();
    };
  }

  if (typeof render === "function") {
    const originalRender = render;
    render = function stableEnglishRender() {
      originalRender();
      applyMedicationStarterUi();
    };
  }

  if (typeof addMessage === "function") {
    const originalAddMessage = addMessage;
    addMessage = function englishAutoTitle(role, content, metadata = {}) {
      const chat = typeof currentChat === "function" ? currentChat() : null;
      const shouldAutoTitle = Boolean(
        chat &&
          role === "user" &&
          state?.settings?.autoTitle &&
          (chat.title === "New chat" || chat.title === "محادثة جديدة" || !chat.title),
      );
      const message = originalAddMessage(role, content, metadata);
      if (shouldAutoTitle && chat) {
        chat.title = String(content || "").replace(/\s+/g, " ").trim().slice(0, 58) || "New chat";
        chat.updatedAt = Date.now();
        if (typeof saveState === "function") saveState();
        if (typeof renderSidebar === "function") renderSidebar();
      }
      applyMedicationStarterUi();
      return message;
    };
  }

  if (typeof state !== "undefined" && Array.isArray(state.chats)) {
    const starterTitles = new Set(["ترتيب الأعراض", "متابعة حرارة وتعب"]);
    state.chats = state.chats.filter((chat) => !starterTitles.has(chat?.title));
    state.chats.forEach((chat) => {
      if (chat?.title === "محادثة جديدة") chat.title = "New chat";
      if (chat?.title === "محادثة مؤقتة") chat.title = "Temporary chat";
    });
    if (!state.chats.length && typeof createBlankChat === "function") {
      state.chats = [createBlankChat()];
      state.currentChatId = state.chats[0].id;
    }
    if (typeof saveState === "function") saveState();
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
      applyMedicationStarterUi();
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

  applyMedicationStarterUi();
})();
