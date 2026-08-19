(() => {
  const MOBILE_QUERY = "(max-width: 820px)";
  const media = window.matchMedia(MOBILE_QUERY);

  function closeHistory() {
    document.body.classList.remove("mobile-history-open");
    document.querySelector('[data-mobile-action="chats"]')?.classList.remove("is-active");
  }

  function openHistory() {
    document.body.classList.add("mobile-history-open");
    document.querySelector('[data-mobile-action="chats"]')?.classList.add("is-active");
  }

  function ensureMobileShell() {
    if (!media.matches) {
      document.body.classList.remove("mobile-app-mode", "mobile-history-open");
      return;
    }

    document.body.classList.add("mobile-app-mode");

    if (!document.querySelector('link[data-hakeem-mobile-css]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/medchat/mobile-app.css";
      link.dataset.hakeemMobileCss = "true";
      document.head.appendChild(link);
    }

    if (!document.querySelector(".mobile-top-title")) {
      const title = document.createElement("div");
      title.className = "mobile-top-title";
      title.textContent = "Hakeem";
      document.querySelector(".topbar")?.appendChild(title);
    }

    if (!document.querySelector(".mobile-nav-backdrop")) {
      const backdrop = document.createElement("div");
      backdrop.className = "mobile-nav-backdrop";
      backdrop.addEventListener("click", closeHistory);
      document.body.appendChild(backdrop);
    }

    if (!document.querySelector(".mobile-bottom-nav")) {
      const nav = document.createElement("nav");
      nav.className = "mobile-bottom-nav";
      nav.setAttribute("aria-label", "Mobile navigation");
      nav.innerHTML = `
        <button type="button" data-mobile-action="new" aria-label="New chat">
          <i data-lucide="square-pen"></i><span>New</span>
        </button>
        <button type="button" data-mobile-action="chats" aria-label="Conversations">
          <i data-lucide="messages-square"></i><span>Chats</span>
        </button>
        <button type="button" data-mobile-action="search" aria-label="Search conversations">
          <i data-lucide="search"></i><span>Search</span>
        </button>
        <button type="button" data-mobile-action="profile" aria-label="Medication profile">
          <i data-lucide="circle-user-round"></i><span>Profile</span>
        </button>`;
      document.body.appendChild(nav);

      nav.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-mobile-action]");
        if (!button) return;
        const action = button.dataset.mobileAction;

        if (action === "new") {
          closeHistory();
          document.getElementById("newChatButton")?.click();
          document.getElementById("promptInput")?.focus();
          return;
        }
        if (action === "chats") {
          document.body.classList.contains("mobile-history-open") ? closeHistory() : openHistory();
          return;
        }
        if (action === "search") {
          closeHistory();
          document.getElementById("searchButton")?.click();
          return;
        }
        if (action === "profile") {
          closeHistory();
          document.getElementById("profileButton")?.click();
        }
      });
    }

    const sidebarToggle = document.querySelector(".sidebar-toggle");
    if (sidebarToggle && !sidebarToggle.dataset.mobileBound) {
      sidebarToggle.dataset.mobileBound = "true";
      sidebarToggle.addEventListener(
        "click",
        (event) => {
          if (!media.matches) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          closeHistory();
        },
        true,
      );
    }

    document.querySelectorAll(".conversation-button").forEach((button) => {
      if (button.dataset.mobileCloseBound) return;
      button.dataset.mobileCloseBound = "true";
      button.addEventListener("click", () => {
        if (media.matches) window.setTimeout(closeHistory, 0);
      });
    });

    if (window.lucide) window.lucide.createIcons();
  }

  let scheduled = false;
  function scheduleShell() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      ensureMobileShell();
    });
  }

  ensureMobileShell();
  media.addEventListener?.("change", ensureMobileShell);

  const conversations = document.getElementById("conversationGroups");
  if (conversations) {
    new MutationObserver(scheduleShell).observe(conversations, { childList: true });
  }
})();
