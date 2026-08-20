"use client";

import { useEffect } from "react";

const STORAGE_KEY = "medchat-state-v1";

function storedTheme(): "light" | "dark" {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const theme = JSON.parse(raw)?.settings?.theme;
      if (theme === "dark" || theme === "light") return theme;
    }
  } catch {
    // Use the system preference below.
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyFavicon(theme: "light" | "dark") {
  const href = theme === "dark" ? "/hakeem-mark-orange.svg?v=2" : "/hakeem-mark.svg?v=2";
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]'));

  if (!links.length) {
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = href;
    document.head.appendChild(link);
    return;
  }

  links.forEach((link) => {
    link.href = href;
    link.type = "image/svg+xml";
  });
}

export default function ThemeFavicon() {
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const sync = () => applyFavicon(storedTheme());

    sync();
    window.addEventListener("storage", sync);
    media?.addEventListener?.("change", sync);

    return () => {
      window.removeEventListener("storage", sync);
      media?.removeEventListener?.("change", sync);
    };
  }, []);

  return null;
}
