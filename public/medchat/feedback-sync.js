(() => {
  const TOKEN_KEY = "ddi_token";
  const FEEDBACK_CACHE_KEY = "hakeem-server-feedback-v1";
  const originalFetch = window.fetch.bind(window);
  let feedbackCache = loadFeedbackCache();
  let uiFrame = 0;

  function loadFeedbackCache() {
    try {
      const raw = localStorage.getItem(FEEDBACK_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveFeedbackCache() {
    localStorage.setItem(FEEDBACK_CACHE_KEY, JSON.stringify(feedbackCache));
  }

  function authHeaders() {
    const token = localStorage.getItem(TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function applyFeedbackUi() {
    const chat = typeof currentChat === "function" ? currentChat() : null;
    if (!chat?.messages || typeof els === "undefined" || !els.messages) return;

    els.messages.querySelectorAll(".message--assistant[data-message-id]").forEach((article) => {
      const message = chat.messages.find((item) => String(item.id) === String(article.dataset.messageId));
      if (!message) return;
      const serverId = message.serverMessageId || message.id;
      const value = feedbackCache[serverId] ?? message.feedback ?? null;
      article.querySelector('[data-hakeem-action="feedback-up"]')?.classList.toggle("is-selected", value === "up");
      article.querySelector('[data-hakeem-action="feedback-down"]')?.classList.toggle("is-selected", value === "down");
    });
  }

  function scheduleFeedbackUi() {
    if (uiFrame) return;
    uiFrame = requestAnimationFrame(() => {
      uiFrame = 0;
      applyFeedbackUi();
    });
  }

  async function syncCurrentFeedback() {
    const token = localStorage.getItem(TOKEN_KEY);
    const chat = typeof currentChat === "function" ? currentChat() : null;
    if (!token || !chat?.backendSessionId) {
      scheduleFeedbackUi();
      return;
    }

    try {
      const response = await originalFetch(`/api/chat/sessions/${chat.backendSessionId}`, {
        headers: authHeaders(),
      });
      if (!response.ok) return;
      const rows = await response.json();
      rows.forEach((row) => {
        if (row.role !== "assistant") return;
        feedbackCache[row.id] = row.feedback ?? null;
        const localMessage = chat.messages.find(
          (message) => message.role === "assistant" && message.content === row.content,
        );
        if (localMessage) {
          localMessage.serverMessageId = row.id;
          localMessage.feedback = row.feedback ?? null;
        }
      });
      saveFeedbackCache();
      scheduleFeedbackUi();
    } catch (error) {
      console.error("Could not sync message feedback", error);
    }
  }

  window.fetch = async function hakeemFeedbackAwareFetch(input, init = {}) {
    const response = await originalFetch(input, init);
    const url = typeof input === "string" ? input : input?.url || "";
    const method = String(init?.method || "GET").toUpperCase();

    if (response.ok && method === "POST" && /\/api\/chat\/?$/.test(url)) {
      response
        .clone()
        .json()
        .then((data) => {
          if (!data?.message_id) return;
          window.setTimeout(() => {
            const chat = typeof currentChat === "function" ? currentChat() : null;
            if (!chat?.messages) return;
            const localMessage = [...chat.messages]
              .reverse()
              .find((message) => message.role === "assistant" && message.content === data.answer);
            if (localMessage) {
              localMessage.serverMessageId = data.message_id;
              localMessage.feedback = null;
            }
            feedbackCache[data.message_id] = null;
            saveFeedbackCache();
            scheduleFeedbackUi();
          }, 80);
        })
        .catch(() => {});
    }

    return response;
  };

  document.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest('[data-hakeem-action="feedback-up"], [data-hakeem-action="feedback-down"]');
      if (!button) return;
      const article = event.target.closest("[data-message-id]");
      const chat = typeof currentChat === "function" ? currentChat() : null;
      const message = chat?.messages?.find((item) => String(item.id) === String(article?.dataset.messageId));
      if (!message) return;

      const serverId = message.serverMessageId || message.id;
      const requested = button.dataset.hakeemAction === "feedback-up" ? "up" : "down";
      const previous = feedbackCache[serverId] ?? message.feedback ?? null;
      const next = previous === requested ? null : requested;

      feedbackCache[serverId] = next;
      message.feedback = next;
      saveFeedbackCache();
      scheduleFeedbackUi();

      originalFetch(`/api/chat/messages/${serverId}/feedback`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ feedback: next }),
      })
        .then(async (response) => {
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || `Feedback request failed (${response.status})`);
          }
          return response.json();
        })
        .then((data) => {
          feedbackCache[serverId] = data.feedback ?? null;
          message.feedback = data.feedback ?? null;
          saveFeedbackCache();
          scheduleFeedbackUi();
        })
        .catch((error) => {
          feedbackCache[serverId] = previous;
          message.feedback = previous;
          saveFeedbackCache();
          scheduleFeedbackUi();
          if (typeof showToast === "function") showToast("Could not save feedback");
          console.error(error);
        });
    },
    true,
  );

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-chat-id], [data-open-search-chat]")) {
      window.setTimeout(syncCurrentFeedback, 250);
    }
  });

  if (typeof els !== "undefined" && els.messages) {
    const messageListObserver = new MutationObserver(() => scheduleFeedbackUi());
    messageListObserver.observe(els.messages, { childList: true });
  }

  window.setTimeout(syncCurrentFeedback, 450);
})();
