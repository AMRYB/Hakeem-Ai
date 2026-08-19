"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Citation = {
  source_type: string;
  source_title: string;
  source_locator: string;
  section?: string | null;
  snippet: string;
};

type SharedMessage = {
  id: string;
  role: string;
  content: string;
  citations: Citation[];
  created_at: string;
};

type SharedChat = {
  chat_id: string;
  share_id: string;
  title: string;
  messages: SharedMessage[];
};

export default function SharedChatPage() {
  const params = useParams<{ shareId: string }>();
  const [chat, setChat] = useState<SharedChat | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!params.shareId) return;
    fetch(`/api/chat/shared/${encodeURIComponent(params.shareId)}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || "Shared conversation not found");
        return data as SharedChat;
      })
      .then(setChat)
      .catch((err: Error) => setError(err.message));
  }, [params.shareId]);

  if (error) {
    return <main style={styles.center}><div style={styles.card}><h1>Hakeem AI</h1><p>{error}</p></div></main>;
  }

  if (!chat) {
    return <main style={styles.center}><div style={styles.card}>Loading shared conversation…</div></main>;
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <strong style={styles.brand}>Hakeem AI</strong>
          <h1 style={styles.title}>{chat.title}</h1>
          <small style={styles.id}>Share ID: {chat.share_id}</small>
        </div>
      </header>
      <section style={styles.thread}>
        {chat.messages.map((message) => (
          <article key={message.id} style={message.role === "user" ? styles.userRow : styles.assistantRow}>
            <div style={message.role === "user" ? styles.userBubble : styles.assistantBubble}>
              {message.content}
              {message.role === "assistant" && message.citations?.length > 0 && (
                <details style={styles.sources}>
                  <summary>View evidence ({message.citations.length})</summary>
                  {message.citations.map((citation, index) => (
                    <div key={`${message.id}-${index}`} style={styles.sourceCard}>
                      <strong>{citation.source_title || citation.source_type}</strong>
                      <small style={styles.sourceMeta}>
                        {[citation.section, citation.source_locator].filter(Boolean).join(" · ")}
                      </small>
                      <p>{citation.snippet}</p>
                    </div>
                  ))}
                </details>
              )}
            </div>
          </article>
        ))}
      </section>
      <footer style={styles.footer}>Shared read-only conversation · Hakeem AI</footer>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#fff", color: "#172033", fontFamily: "Inter, Arial, sans-serif" },
  center: { minHeight: "100vh", display: "grid", placeItems: "center", background: "#f7f9fc", fontFamily: "Inter, Arial, sans-serif" },
  card: { padding: 28, border: "1px solid #e4e9f2", borderRadius: 18, background: "#fff" },
  header: { maxWidth: 900, margin: "0 auto", padding: "42px 24px 22px", borderBottom: "1px solid #e9edf3" },
  brand: { color: "#0b57d0", fontSize: 16 },
  title: { margin: "10px 0 6px", fontSize: 28, lineHeight: 1.2 },
  id: { color: "#738095" },
  thread: { maxWidth: 900, margin: "0 auto", padding: "28px 24px 80px", display: "grid", gap: 26 },
  userRow: { display: "flex", justifyContent: "flex-end" },
  assistantRow: { display: "flex", justifyContent: "flex-start" },
  userBubble: { maxWidth: "75%", padding: "12px 16px", borderRadius: 14, background: "#f1f3f5", whiteSpace: "pre-wrap", lineHeight: 1.6 },
  assistantBubble: { maxWidth: "86%", whiteSpace: "pre-wrap", lineHeight: 1.7 },
  sources: { marginTop: 16, paddingTop: 12, borderTop: "1px solid #e6ebf2", color: "#315d9d" },
  sourceCard: { marginTop: 12, padding: 12, border: "1px solid #dfe7f3", borderRadius: 12, color: "#172033", whiteSpace: "normal" },
  sourceMeta: { display: "block", marginTop: 3, color: "#738095" },
  footer: { maxWidth: 900, margin: "0 auto", padding: "20px 24px 34px", color: "#7d8797", fontSize: 12, borderTop: "1px solid #eef1f5" },
};
