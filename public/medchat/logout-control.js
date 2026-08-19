(() => {
  const TOKEN_KEY = "ddi_token";

  function installLogout() {
    document.getElementById("changeAccountButton")?.remove();

    const bottom = document.querySelector(".sidebar__bottom");
    if (!bottom || document.getElementById("hakeemLogoutButton")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "hakeemLogoutButton";
    button.className = "hakeem-logout-button";
    button.setAttribute("aria-label", "Log out");
    button.setAttribute("title", "Log out");
    button.innerHTML = `
      <i data-lucide="log-out"></i>
      <span>Log out</span>
    `;

    button.addEventListener("click", () => {
      localStorage.removeItem(TOKEN_KEY);
      window.top.location.href = "/signup";
    });

    bottom.appendChild(button);

    if (!document.getElementById("hakeemLogoutStyles")) {
      const style = document.createElement("style");
      style.id = "hakeemLogoutStyles";
      style.textContent = `
        .sidebar__bottom {
          display: grid !important;
          gap: 4px !important;
        }
        .hakeem-logout-button {
          width: 100%;
          min-height: 38px;
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 8px 10px;
          border: 0;
          border-radius: 10px;
          background: transparent;
          color: rgba(255,255,255,.78);
          font: inherit;
          font-size: 12px;
          font-weight: 600;
          text-align: left;
          cursor: pointer;
        }
        .hakeem-logout-button:hover {
          background: transparent;
          color: #fff;
        }
        .hakeem-logout-button svg {
          width: 16px;
          height: 16px;
        }
        .app-shell[data-sidebar="closed"] .hakeem-logout-button span {
          display: none;
        }
        .app-shell[data-sidebar="closed"] .hakeem-logout-button {
          justify-content: center;
          padding-inline: 0;
        }
        @media (max-width: 820px) {
          .hakeem-logout-button {
            min-height: 44px;
            padding: 10px 12px;
          }
        }
      `;
      document.head.appendChild(style);
    }

    if (window.lucide) window.lucide.createIcons();
  }

  installLogout();
  window.setTimeout(installLogout, 0);
})();
