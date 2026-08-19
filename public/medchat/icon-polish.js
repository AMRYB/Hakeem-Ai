(() => {
  function usePillIcon() {
    const icon = document.querySelector(".project-title__icon");
    if (!icon) return;
    icon.setAttribute("data-lucide", "pill");
    icon.setAttribute("aria-hidden", "true");
    if (window.lucide) window.lucide.createIcons();
  }

  usePillIcon();
  requestAnimationFrame(usePillIcon);
})();
