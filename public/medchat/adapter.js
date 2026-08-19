(() => {
  const TOKEN_KEY = "ddi_token";
  const MESSAGE_META_KEY = "hakeem-message-meta-v1";

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
    ["اكتب اللي حاسس بيه", "Message Hakeem AI"],
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
    ["تشغيل الصوت", "Read aloud"],
    ["تعذر تشغيل الصوت", "Could not play audio"],
    ["نسخ", "Copy"],
    ["تعديل", "Edit"],
    ["إعادة المحاولة", "Regenerate"],
    ["إزالة المرفق", "Remove attachment"],
  ]);

  let activeRecognition = null;
  let messageMeta = loadMessageMeta();

  function loadMessageMeta() {
    try {
      const raw = localStorage.getItem(MESSAGE_META_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveMessageMeta() {
    localStorage.setItem(MESSAGE_META_KEY, JSON.stringify(messageMeta));
  }

  function simpleHash(value) {
    let hash = 2166136261;
    const text = String(value || "");
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function messageMetaKey(chat, message) {
    const session = chat?.backendSessionId || chat?.id || "local";
    return `${session}:${message?.role || "message"}:${simpleHash(message?.content || "")}`;
  }

  function getMessageMeta(chat, message) {
    return messageMeta[messageMetaKey(chat, message)] || {};
  }

  function patchMessageMeta(chat, message, patch) {
    const key = messageMetaKey(chat, message);
    messageMeta[key] = { ...(messageMeta[key] || {}), ...patch };
    saveMessageMeta();
  }

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

  function formatCitationText(citation, index) {
    const title = citation?.source_title || citation?.source_type || `Source ${index + 1}`;
    const locator = citation?.source_locator ? ` — ${citation.source_locator}` : "";
    const section = citation?.section ? ` — ${citation.section}` : "";
    const snippet = citation?.snippet ? `\n${citation.snippet}` : "";
    return `[${index + 1}] ${title}${locator}${section}${snippet}`;
  }

  function answerWithSourcesText(message) {
    const citations = Array.isArray(message?.citations) ? message.citations : [];
    if (!citations.length) return String(message?.content || "");
    return `${message.content}\n\nSources\n${citations.map(formatCitationText).join("\n\n")}`;
  }

  async function writeClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function formatResponseTime(ms) {
    if (!Number.isFinite(ms)) return "";
    if (ms < 1000) return `Answered in ${Math.max(1, Math.round(ms))}ms`;
    return `Answered in ${(ms / 1000).toFixed(1)}s`;
  }

  function ensureFeatureUi() {
    if (!document.getElementById("evidenceDrawer")) {
      const backdrop = document.createElement("div");
      backdrop.className = "feature-drawer-backdrop";
      backdrop.id = "evidenceBackdrop";
      backdrop.hidden = true;
      backdrop.innerHTML = `
        <aside class="feature-drawer" id="evidenceDrawer" role="dialog" aria-modal="true" aria-labelledby="evidenceTitle">
          <div class="feature-drawer__header">
            <div>
              <span class="feature-drawer__eyebrow">Grounded response</span>
              <h2 id="evidenceTitle">Evidence & sources</h2>
            </div>
            <button type="button" class="feature-icon-button" data-close-evidence aria-label="Close evidence" title="Close evidence">
              <i data-lucide="x"></i>
            </button>
          </div>
          <div class="feature-drawer__content" id="evidenceContent"></div>
        </aside>`;
      document.body.append(backdrop);
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop || event.target.closest("[data-close-evidence]")) closeEvidenceDrawer();
      });
    }

    if (!document.getElementById("exportModal")) {
      const modal = document.createElement("div");
      modal.className = "feature-modal";
      modal.id = "exportModal";
      modal.hidden = true;
      modal.innerHTML = `
        <div class="feature-modal__panel" role="dialog" aria-modal="true" aria-labelledby="exportTitle">
          <div class="feature-modal__header">
            <div>
              <span class="feature-drawer__eyebrow">Conversation report</span>
              <h2 id="exportTitle">Export conversation</h2>
            </div>
            <button type="button" class="feature-icon-button" data-close-export aria-label="Close export" title="Close export">
              <i data-lucide="x"></i>
            </button>
          </div>
          <p>Export the current conversation together with response timing and cited evidence.</p>
          <div class="feature-export-actions">
            <button type="button" data-export-format="text">
              <i data-lucide="file-text"></i>
              <span><strong>Download text</strong><small>Plain .txt report</small></span>
            </button>
            <button type="button" data-export-format="pdf">
              <i data-lucide="file-down"></i>
              <span><strong>Save as PDF</strong><small>Opens print / PDF view</small></span>
            </button>
          </div>
        </div>`;
      document.body.append(modal);
      modal.addEventListener("click", (event) => {
        if (event.target === modal || event.target.closest("[data-close-export]")) {
          closeExportModal();
          return;
        }
        const button = event.target.closest("[data-export-format]");
        if (!button) return;
        const format = button.dataset.exportFormat;
        closeExportModal();
        if (format === "text") exportCurrentConversationText();
        if (format === "pdf") exportCurrentConversationPdf();
      });
    }

    refreshIcons();
  }

  function openEvidenceDrawer(message) {
    ensureFeatureUi();
    const citations = Array.isArray(message?.citations) ? message.citations : [];
    const content = document.getElementById("evidenceContent");
    const backdrop = document.getElementById("evidenceBackdrop");
    if (!content || !backdrop) return;

    if (!citations.length) {
      content.innerHTML = `<div class="feature-empty"><i data-lucide="search-x"></i><p>No cited evidence was returned for this answer.</p></div>`;
    } else {
      content.innerHTML = citations
        .map((citation, index) => `
          <article class="evidence-card">
            <div class="evidence-card__top">
              <span class="evidence-index">${index + 1}</span>
              <div class="evidence-card__details">
                <div class="evidence-card__title-row">
                  <strong>${escapeHtml(citation.source_title || citation.source_type || `Source ${index + 1}`)}</strong>
                  ${citation.relevance_percentage != null &&
                  Number.isFinite(Number(citation.relevance_percentage))
                    ? `<span class="evidence-relevance" title="Source relevance to this question">${Math.max(0, Math.min(100, Math.round(Number(citation.relevance_percentage))))}%</span>`
                    : ""}
                </div>
                <small>${escapeHtml([citation.source_type, citation.section, citation.source_locator].filter(Boolean).join(" · "))}</small>
              </div>
            </div>
            <p>${escapeHtml(citation.snippet || "No snippet available.")}</p>
          </article>`)
        .join("");
    }

    backdrop.hidden = false;
    document.body.classList.add("feature-overlay-open");
    refreshIcons();
  }

  function closeEvidenceDrawer() {
    const backdrop = document.getElementById("evidenceBackdrop");
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove("feature-overlay-open");
  }

  function openExportModal() {
    ensureFeatureUi();
    const modal = document.getElementById("exportModal");
    if (modal) modal.hidden = false;
    document.body.classList.add("feature-overlay-open");
    refreshIcons();
  }

  function closeExportModal() {
    const modal = document.getElementById("exportModal");
    if (modal) modal.hidden = true;
    document.body.classList.remove("feature-overlay-open");
  }

  function buildConversationReport() {
    const chat = currentChat();
    if (!chat) return "";
    const lines = [
      "Hakeem AI — Conversation Report",
      `Conversation: ${chat.title || "Untitled conversation"}`,
      `Exported: ${new Date().toLocaleString("en-US")}`,
      "",
    ];

    for (const message of chat.messages || []) {
      if (message.isTyping) continue;
      const speaker = message.role === "assistant" ? "Hakeem AI" : "You";
      lines.push(`${speaker}:`);
      lines.push(String(message.content || ""));
      if (message.role === "assistant") {
        const meta = getMessageMeta(chat, message);
        if (meta.responseTimeMs) lines.push(formatResponseTime(meta.responseTimeMs));
        const citations = Array.isArray(message.citations) ? message.citations : [];
        if (citations.length) {
          lines.push("Sources:");
          citations.forEach((citation, index) => lines.push(formatCitationText(citation, index)));
        }
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  function exportCurrentConversationText() {
    const report = buildConversationReport();
    if (!report.trim()) {
      showToast("There is no conversation to export");
      return;
    }
    const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `hakeem-conversation-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Text report downloaded");
  }

  function exportCurrentConversationPdf() {
    const report = buildConversationReport();
    if (!report.trim()) {
      showToast("There is no conversation to export");
      return;
    }
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      showToast("Allow pop-ups to export PDF");
      return;
    }
    printWindow.opener = null;
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Hakeem AI Conversation Report</title><style>body{font-family:Inter,Arial,sans-serif;max-width:820px;margin:40px auto;padding:0 28px;color:#172033;line-height:1.55}h1{font-size:24px;margin-bottom:20px}.report{white-space:pre-wrap;font-size:14px}@media print{body{margin:0;max-width:none}}</style></head><body><h1>Hakeem AI Conversation Report</h1><div class="report">${escapeHtml(report)}</div></body></html>`);
    printWindow.document.close();
    window.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 250);
  }

  function enhanceRenderedMessages() {
    const chat = currentChat();
    if (!chat) return;

    els.messages.querySelectorAll(".message--assistant[data-message-id]").forEach((article) => {
      const message = chat.messages.find((item) => String(item.id) === String(article.dataset.messageId));
      if (!message || message.isTyping) return;
      const actions = article.querySelector(".message-actions");
      if (!actions) return;

      const meta = getMessageMeta(chat, message);
      const copyButton = actions.querySelector('[data-message-action="copy"]');
      if (copyButton) {
        copyButton.setAttribute("aria-label", "Copy answer and sources");
        copyButton.setAttribute("title", "Copy answer and sources");
      }

      if (!actions.querySelector('[data-hakeem-action="feedback-up"]')) {
        actions.insertAdjacentHTML("beforeend", `
          <span class="message-action-separator" aria-hidden="true"></span>
          <button class="message-action hakeem-feedback-button ${meta.feedback === "up" ? "is-selected" : ""}" type="button" data-hakeem-action="feedback-up" aria-label="Helpful answer" title="Helpful answer">
            <i data-lucide="thumbs-up"></i>
          </button>
          <button class="message-action hakeem-feedback-button ${meta.feedback === "down" ? "is-selected" : ""}" type="button" data-hakeem-action="feedback-down" aria-label="Not helpful" title="Not helpful">
            <i data-lucide="thumbs-down"></i>
          </button>`);
      } else {
        actions.querySelector('[data-hakeem-action="feedback-up"]')?.classList.toggle("is-selected", meta.feedback === "up");
        actions.querySelector('[data-hakeem-action="feedback-down"]')?.classList.toggle("is-selected", meta.feedback === "down");
      }

      if (Array.isArray(message.citations) && message.citations.length && !actions.querySelector('[data-hakeem-action="evidence"]')) {
        actions.insertAdjacentHTML("beforeend", `
          <button class="evidence-button" type="button" data-hakeem-action="evidence">
            <i data-lucide="book-open-text"></i>
            <span>View evidence</span>
            <b>${message.citations.length}</b>
          </button>`);
      }

      if (meta.responseTimeMs && !article.querySelector(".response-time-badge")) {
        const badge = document.createElement("span");
        badge.className = "response-time-badge";
        badge.innerHTML = `<i data-lucide="timer"></i>${escapeHtml(formatResponseTime(meta.responseTimeMs))}`;
        actions.append(badge);
      }
    });
    refreshIcons();
  }

  function handleMessageFeatureClick(event) {
    const button = event.target.closest("[data-hakeem-action], [data-message-action='copy']");
    if (!button) return;
    const article = event.target.closest("[data-message-id]");
    const chat = currentChat();
    const message = chat?.messages.find((item) => String(item.id) === String(article?.dataset.messageId));
    if (!chat || !message) return;

    const hakeemAction = button.dataset.hakeemAction;
    if (hakeemAction === "evidence") {
      event.preventDefault();
      event.stopImmediatePropagation();
      openEvidenceDrawer(message);
      return;
    }

    if (hakeemAction === "feedback-up" || hakeemAction === "feedback-down") {
      event.preventDefault();
      event.stopImmediatePropagation();
      const feedback = hakeemAction === "feedback-up" ? "up" : "down";
      const current = getMessageMeta(chat, message).feedback;
      patchMessageMeta(chat, message, { feedback: current === feedback ? null : feedback });
      enhanceRenderedMessages();
      showToast(current === feedback ? "Feedback removed" : "Thanks for your feedback");
      return;
    }

    if (message.role === "assistant" && button.dataset.messageAction === "copy") {
      event.preventDefault();
      event.stopImmediatePropagation();
      writeClipboard(answerWithSourcesText(message))
        .then(() => showToast("Answer and sources copied"))
        .catch(() => showToast("Could not copy answer"));
    }
  }

  function startSpeechRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      showToast("Speech recognition is not supported in this browser");
      return;
    }

    if (activeRecognition) {
      activeRecognition.stop();
      return;
    }

    const recognition = new Recognition();
    activeRecognition = recognition;
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalTranscript = "";
    recognition.onstart = () => {
      els.micButton.classList.add("is-listening");
      els.micButton.setAttribute("aria-label", "Stop listening");
      els.micButton.setAttribute("title", "Stop listening");
      showToast("Listening…");
    };
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) finalTranscript += `${transcript} `;
        else interim += transcript;
      }
      els.promptInput.value = `${finalTranscript}${interim}`.trimStart();
      syncPromptInput();
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted") showToast(`Microphone error: ${event.error}`);
    };
    recognition.onend = () => {
      activeRecognition = null;
      els.micButton.classList.remove("is-listening");
      els.micButton.setAttribute("aria-label", "Voice input");
      els.micButton.setAttribute("title", "Voice input");
      syncPromptInput();
      focusPrompt();
    };
    recognition.start();
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
        translateTree(document.body);
        enhanceRenderedMessages();
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
      enhanceRenderedMessages();
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
      utterance.rate = 1;
      window.speechSynthesis.speak(utterance);
      showToast("Reading response aloud");
    };
  }

  simulateAssistant = async function(prompt) {
    const chat = currentChat();
    if (!chat) return;
    const startedAt = performance.now();
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
        target.route = result.route || null;
        target.model = "hakeem-ai";
        patchMessageMeta(chat, target, { responseTimeMs: Math.round(performance.now() - startedAt) });
      }
      chat.updatedAt = Date.now();
      saveState();
      render();
      translateTree(document.body);
      enhanceRenderedMessages();
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
      enhanceRenderedMessages();
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

  ensureFeatureUi();

  const uiObserver = new MutationObserver((mutations) => {
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
    enhanceRenderedMessages();
  });
  uiObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["placeholder", "aria-label", "title"],
  });
  translateTree(document.body);
  enhanceRenderedMessages();

  els.messages.addEventListener("click", handleMessageFeatureClick, true);

  els.micButton.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      startSpeechRecognition();
    },
    true,
  );

  els.exportButton.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      openExportModal();
    },
    true,
  );

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

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeEvidenceDrawer();
      closeExportModal();
    }
  });

  hydrateBackend();
})();
