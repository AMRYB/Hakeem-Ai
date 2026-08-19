"use client";

import { useRef } from "react";

export default function ChatPage() {
  const observersRef = useRef<MutationObserver[]>([]);

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

    observersRef.current.forEach((observer) => observer.disconnect());
    observersRef.current = [];

    enforceEnglishUi(doc);
    ensureFeedbackSync(doc);

    const prompt = doc.getElementById("promptInput");
    if (prompt) {
      const promptObserver = new MutationObserver(() => enforceEnglishUi(doc));
      promptObserver.observe(prompt, {
        attributes: true,
        attributeFilter: ["placeholder"],
      });
      observersRef.current.push(promptObserver);
    }

    const thinkingButton = doc.getElementById("thinkingModeButton");
    if (thinkingButton) {
      const thinkingObserver = new MutationObserver(() => enforceEnglishUi(doc));
      thinkingObserver.observe(thinkingButton, {
        attributes: true,
        attributeFilter: ["data-mode", "aria-label", "title"],
      });
      observersRef.current.push(thinkingObserver);
    }

    const thinkingLabel = doc.getElementById("thinkingModeLabel");
    if (thinkingLabel) {
      const labelObserver = new MutationObserver(() => enforceEnglishUi(doc));
      labelObserver.observe(thinkingLabel, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      observersRef.current.push(labelObserver);
    }
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
