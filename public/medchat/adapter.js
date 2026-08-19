(() => {
  const TOKEN_KEY = "ddi_token";

  const dictionary = new Map([
    ["محادثة جديدة", "New chat"],
    ["محادثة مؤقتة", "Temporary chat"],
    ["مثبتة", "Pinned"],
    ["اليوم", "Today"],
    ["السابق", "Earlier"],
    ["لا توجد نتائج", "No results"],
    ["عادي", "Normal"],
    ["متقدم", "Advanced"],
    ["التفكير العادي", "Normal reasoning"],
    ["التفكير المتقدم", "Advanced reasoning"],
    ["إلغاء التثبيت", "Unpin conversation"],
    ["تثبيت المحادثة", "Pin conversation"],
    ["الأكونتات المحفوظة", "Saved accounts"],
    ["الأكونت الحالي", "Current account"],
    ["اضغط للتبديل", "Click to switch"],
    ["كمل...", "Continue..."],
    ["إرسال الرسالة", "Send message"],
    ["إدخال صوتي", "Voice input"],
    ["تم النسخ", "Copied"],
    ["تم إرفاق الملفات", "Files attached"],
    ["تم حذف المحادثة", "Conversation deleted"],
    ["تم تغيير الثيم", "Theme changed"],
    ["تم مسح المحادثات", "Conversations cleared"],
    ["تم تجهيز التصدير", "Export ready"],
    ["المشاركة قريبًا", "Sharing is coming soon"],
    ["محادثة جماعية قريبًا", "Group chat is coming soon"],
    ["الأرشفة قريبًا", "Archive is coming soon"],
    ["عرض الملفات قريبًا", "File view is coming soon"],
    ["لا توجد محادثات مثبتة", "No pinned conversations"],
    ["هذه محادثة مؤقتة", "This is a temporary chat"],
    ["تم تفعيل المحادثة المؤقتة", "Temporary chat enabled"],
    ["جار تجهيز الصوت...", "Preparing audio..."],
    ["تشغيل الصوت", "Playing audio"],
    ["تعذر تشغيل الصوت", "Could not play audio"],
    ["نسخ", "Copy"],
    ["تعديل", "Edit"],
    ["تشغيل الصوت", "Read aloud"],
    ["إعادة المحاولة", "Regenerate"],
    ["إزالة المرفق", "Remove attachment"],
  ]);

  function translateValue(value) {
    if (!value) return value;
    const leading = value.match(/^\s*/)?.[0] || "";
    const trailing = value.match(/\s*$/)?.[0] || "";
    const core = value.trim();
    if (dictionary.has(core)) return `${leading}${dictionary.get(core)}${trailing}`;
    return value
      .replace(/(\d+) رسائل/g, "$1 messages")
      .replace(/رسالة واحدة/g, "1 message");
  }

  function translateTree(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const next = translateValue(node.nodeValue || "");
      if (next !== node.nodeValue) node.nodeValue = next;
    });
    if (root.querySelectorAll) {
      root.querySelectorAll("[placeholder],[aria-label],[title]").forEach((el) => {
        ["placeholder", "aria-label", "title"].forEach((attr) => {
          if (!el.hasAttribute(attr)) return;
          const current = el.getAttribute(attr);
          const next = translateValue(current);
          if (next !== current) el.setAttribute(attr, next);
        });
      });
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        const next = translateValue(mutation.target.nodeValue || "");
        if (next !== mutation.target.nodeValue) mutation.target.nodeValue = next;
      }
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) translateTree(node);
        if (node.nodeType === Node.TEXT_NODE) {
          const next = translateValue(node.nodeValue || "");
          if (next !== node.nodeValue) node.nodeValue = next;
        }
      });
      if (mutation.type === "attributes") translateTree(mutation.target);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "aria-label", "title"] });
  translateTree(document.body);

  async function hakeemFetch(path, options = {}) {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      window.top.location.href = "/login";
      throw new Error("Please sign in first.");
    }
    const headers = new Headers(options.headers || {});
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(path, { ...options, headers });
    if (response.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      window.top.location.href = "/login";
      throw new Error("Your session expired.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
    return data;
  }

  function dateValue(value) {
    const n = new Date(value).getTime();
    return Number.isFinite(n) ? n : Date.now();
  }

  async function loadServerMessages(chat) {
    if (!chat?.backendSessionId || chat.backendLoaded || chat.backendLoading) return;
    chat.backendLoading = true;
    try {
      const rows = await hakeemFetch(`/api/chat/sessions/${chat.backendSessionId}`);
      chat.messages = rows.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        citations: message.citations || [],
        createdAt: dateValue(message.created_at),
        model: "hakeem-ai",
      }));
      chat.backendLoaded = true;
      chat.updatedAt = chat.messages.at(-1)?.createdAt || chat.updatedAt;
      saveState();
      if (currentChat()?.id === chat.id) {
        render();
        scrollToBottom();
      }
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not load conversation");
    } finally {
      chat.backendLoading = false;
    }
  }

  async function hydrateBackend() {
    if (!localStorage.getItem(TOKEN_KEY)) {
      window.top.location.href = "/login";
      return;
    }
    try {
      const [sessions, profile] = await Promise.all([
        hakeemFetch("/api/chat/sessions"),
        hakeemFetch("/api/profile").catch(() => null),
      ]);

      if (profile?.name) {
        state.settings.userName = profile.name;
        state.settings.accounts = [profile.name];
      }

      state.chats = sessions.map((session) => ({
        id: session.id,
        backendSessionId: session.id,
        backendLoaded: false,
        title: session.title || "New chat",
        pinned: false,
        createdAt: dateValue(session.updated_at),
        updatedAt: dateValue(session.updated_at),
        messages: [],
      }));

      if (!state.chats.length) state.chats = [createBlankChat()];
      state.currentChatId = state.chats[0].id;
      saveState();
      render();
      translateTree(document.body);
      await loadServerMessages(currentChat());
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not sync conversations");
    }
  }

  if (typeof formatDate === "function") {
    formatDate = function(timestamp) {
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(timestamp));
    };
  }

  if (typeof speakText === "function") {
    speakText = function(text) {
      const clean = String(text || "").trim();
      if (!clean) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = "en-US";
      window.speechSynthesis.speak(utterance);
      showToast("Reading response aloud");
    };
  }

  simulateAssistant = async function(prompt) {
    const chat = currentChat();
    if (!chat) return;
    const typingMessage = addMessage("assistant", "", { isTyping: true, model: "hakeem-ai" });
    try {
      const result = await hakeemFetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: prompt, session_id: chat.backendSessionId || null }),
      });
      chat.backendSessionId = result.session_id;
      const target = chat.messages.find((message) => message.id === typingMessage.id);
      if (target) {
        target.isTyping = false;
        target.content = result.answer;
        target.citations = result.citations || [];
        target.model = "hakeem-ai";
      }
      chat.updatedAt = Date.now();
      saveState();
      render();
      translateTree(document.body);
      scrollToBottom();
    } catch (error) {
      const target = chat.messages.find((message) => message.id === typingMessage.id);
      if (target) {
        target.isTyping = false;
        target.content = `I could not complete that request. ${error.message || "Please try again."}`;
      }
      saveState();
      render();
      translateTree(document.body);
    }
  };

  submitPrompt = async function(text = els.promptInput.value) {
    const prompt = String(text || "").trim();
    if (!prompt) return;
    let chat = currentChat();
    if (!chat) {
      createChat();
      chat = currentChat();
    }
    addMessage("user", prompt, {
      attachments: state.attachments.map((file) => ({ name: file.name, size: file.size })),
    });
    els.promptInput.value = "";
    state.attachments = [];
    syncPromptInput();
    renderAttachments();
    await simulateAssistant(prompt);
  };

  els.conversationGroups.addEventListener("click", (event) => {
    const button = event.target.closest("[data-chat-id]");
    if (!button) return;
    setTimeout(() => loadServerMessages(currentChat()), 0);
  });

  els.searchResults.addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-search-chat]");
    if (!button) return;
    setTimeout(() => loadServerMessages(currentChat()), 0);
  });

  hydrateBackend();
})();
