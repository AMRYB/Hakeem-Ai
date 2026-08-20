(() => {
  const PROFILE_TOKEN_KEY = "ddi_token";
  const BRAND_SRC = "/hakeem-mark.svg";
  let scheduled = false;

  function userInitial(name) {
    const value = String(name || "").trim();
    return value ? value.charAt(0).toUpperCase() : "U";
  }

  function syncProfileDom() {
    const name = String(window.HAKEEM_PROFILE_NAME || "").trim();
    if (!name) return;

    const profileName = document.querySelector("#profileName");
    const profileAvatar = document.querySelector("#profileAvatar");

    if (profileName && profileName.textContent !== name) profileName.textContent = name;
    if (profileAvatar && profileAvatar.textContent !== userInitial(name)) {
      profileAvatar.textContent = userInitial(name);
    }
  }

  function syncAssistantAvatars() {
    document.querySelectorAll(".message__avatar").forEach((avatar) => {
      if (avatar.querySelector("img.hakeem-assistant-mark")) return;

      const sparkles = avatar.querySelector(
        'i[data-lucide="sparkles"], svg[data-lucide="sparkles"], svg.lucide-sparkles'
      );
      if (!sparkles) return;

      avatar.innerHTML = "";
      const image = document.createElement("img");
      image.className = "hakeem-assistant-mark";
      image.src = BRAND_SRC;
      image.alt = "Hakeem";
      image.decoding = "async";
      avatar.appendChild(image);
    });
  }

  function syncAll() {
    syncProfileDom();
    syncAssistantAvatars();
  }

  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      syncAll();
    });
  }

  async function loadProfile() {
    const token = localStorage.getItem(PROFILE_TOKEN_KEY);
    if (!token) return;

    try {
      const response = await fetch("/api/profile", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;

      const profile = await response.json();
      const name = String(profile?.name || "").trim();
      if (!name) return;

      window.HAKEEM_PROFILE_NAME = name;
      syncAll();
    } catch {
      // Keep the chat usable if profile synchronization is temporarily unavailable.
    }
  }

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  syncAll();
  loadProfile();
})();
