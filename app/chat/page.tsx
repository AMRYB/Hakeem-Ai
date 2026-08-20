"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "@/lib/api";

type Theme = "light" | "dark";
type Profile = {
  name: string;
  age: number;
  health_notes: string;
};

function readTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const raw = localStorage.getItem("medchat-state-v1");
    if (raw) {
      const theme = JSON.parse(raw)?.settings?.theme;
      if (theme === "dark" || theme === "light") return theme;
    }
  } catch {
    // Use system preference below.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function ChatPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(readTheme());

    if (!getToken()) {
      router.replace("/signup");
      return;
    }

    let cancelled = false;

    apiFetch<Profile | null>("/api/profile")
      .then((profile) => {
        if (cancelled) return;
        if (!profile) {
          router.replace("/onboarding");
          return;
        }
        setAuthorized(true);
      })
      .catch(() => {
        if (!cancelled) setAuthorized(true);
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  function ensureScript(doc: Document, src: string, marker: string) {
    if (doc.querySelector(`script[data-${marker}]`)) return;
    const script = doc.createElement("script");
    script.src = src;
    script.async = false;
    script.dataset[marker.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = "true";
    doc.body.appendChild(script);
  }

  function ensureStylesheet(doc: Document, href: string, marker: string) {
    if (doc.querySelector(`link[data-${marker}]`)) return;
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset[marker.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = "true";
    doc.head.appendChild(link);
  }

  function handleFrameLoad(event: React.SyntheticEvent<HTMLIFrameElement>) {
    const doc = event.currentTarget.contentDocument;
    if (!doc) return;

    ensureScript(doc, "/medchat/feedback-sync.js", "hakeem-feedback-sync");
    ensureScript(doc, "/medchat/production-fixes.js", "hakeem-production-fixes");
    ensureScript(doc, "/medchat/response-ui.js", "hakeem-response-ui");
    ensureScript(doc, "/medchat/mobile-app.js", "hakeem-mobile-app");
    ensureScript(doc, "/medchat/icon-polish.js", "hakeem-icon-polish");
    ensureScript(doc, "/medchat/logout-control.js", "hakeem-logout-control");
    ensureScript(doc, "/medchat/brand-sync.js", "hakeem-brand-sync");

    ensureStylesheet(doc, "/medchat/theme-polish.css", "hakeem-theme-polish");
    ensureStylesheet(doc, "/medchat/brand-mark.css", "hakeem-brand-mark");
  }

  if (!authorized) return null;

  return (
    <iframe
      src="/medchat/index.html"
      title="Hakeem chat"
      allow="microphone"
      onLoad={handleFrameLoad}
      style={{
        width: "100vw",
        height: "100vh",
        border: 0,
        display: "block",
        background: theme === "dark" ? "#111" : "white",
      }}
    />
  );
}
