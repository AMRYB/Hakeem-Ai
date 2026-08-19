"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import HakeemLoader from "@/components/HakeemLoader";
import { getToken } from "@/lib/api";

type Theme = "light" | "dark";

function readTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const raw = localStorage.getItem("medchat-state-v1");
    if (raw) {
      const theme = JSON.parse(raw)?.settings?.theme;
      if (theme === "dark" || theme === "light") return theme;
    }
  } catch {
    // Use the system preference below.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function Home() {
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(readTheme());
    router.replace(getToken() ? "/chat" : "/signup");
  }, [router]);

  return <HakeemLoader fullscreen theme={theme} label="Opening Hakeem…" />;
}
