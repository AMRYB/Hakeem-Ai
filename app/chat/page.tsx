"use client";

export default function ChatPage() {
  function ensureScript(doc: Document, src: string, marker: string) {
    if (doc.querySelector(`script[data-${marker}]`)) return;
    const script = doc.createElement("script");
    script.src = src;
    script.dataset[marker.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = "true";
    doc.body.appendChild(script);
  }

  function handleFrameLoad(event: React.SyntheticEvent<HTMLIFrameElement>) {
    const doc = event.currentTarget.contentDocument;
    if (!doc) return;
    ensureScript(doc, "/medchat/feedback-sync.js", "hakeem-feedback-sync");
    ensureScript(doc, "/medchat/production-fixes.js", "hakeem-production-fixes");
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
