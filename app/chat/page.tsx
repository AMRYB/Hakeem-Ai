"use client";

import { useRef } from "react";

export default function ChatPage() {
  const observerRef = useRef<MutationObserver | null>(null);

  function enforceEnglishUi(doc: Document) {
    const prompt = doc.getElementById("promptInput") as HTMLTextAreaElement | null;
    if (prompt) {
      if (prompt.placeholder === "اكتب اللي حاسس بيه") {
        prompt.placeholder = "Message Hakeem AI";
      } else if (prompt.placeholder === "كمل...") {
        prompt.placeholder = "Continue...";
      }
    }

    const thinkingButton = doc.getElementById("thinkingModeButton") as HTMLButtonElement | null;
    const thinkingLabel = doc.getElementById("thinkingModeLabel");

    if (thinkingButton) {
      const advanced = thinkingButton.dataset.mode === "advanced";
      const englishLabel = advanced ? "Advanced" : "Normal";
      const englishTitle = advanced ? "Advanced reasoning" : "Normal reasoning";

      if (thinkingLabel && thinkingLabel.textContent !== englishLabel) {
        thinkingLabel.textContent = englishLabel;
      }
      if (thinkingButton.getAttribute("aria-label") !== englishTitle) {
        thinkingButton.setAttribute("aria-label", englishTitle);
      }
      if (thinkingButton.getAttribute("title") !== englishTitle) {
        thinkingButton.setAttribute("title", englishTitle);
      }
    }
  }

  function ensureFeedbackSync(doc: Document) {
    if (doc.querySelector("script[data-hakeem-feedback-sync]")) return;
    const script = doc.createElement("script");
    script.src = "/medchat/feedback-sync.js";
    script.dataset.hakeemFeedbackSync = "true";
    doc.body.appendChild(script);
  }

  function handleFrameLoad(event: React.SyntheticEvent<HTMLIFrameElement>) {
    const frame = event.currentTarget;
    const doc = frame.contentDocument;
    if (!doc) return;

    observerRef.current?.disconnect();
    enforceEnglishUi(doc);
    ensureFeedbackSync(doc);

    const observer = new MutationObserver(() => enforceEnglishUi(doc));
    observer.observe(doc.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["placeholder", "aria-label", "title", "data-mode"],
    });
    observerRef.current = observer;
  }

  return (
    <iframe
      src="/medchat/index.html"
      title="Hakeem AI chat"
      allow="microphone"
      onLoad={handleFrameLoad}
      style={{ width: "100vw", height: "100vh", border: 0, display: "block", background: "white" }}
    />
  );
}
