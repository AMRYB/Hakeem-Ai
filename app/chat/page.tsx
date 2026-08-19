"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ChatMessage, Citation, clearToken, getToken } from "@/lib/api";
import LogoMark from "@/components/LogoMark";

type Session = { id: string; title: string; updated_at: string };
type LocalMessage = { id: string; role: "user" | "assistant"; content: string; citations: Citation[] };

export default function ChatPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  async function refreshSessions() { setSessions(await apiFetch<Session[]>("/api/chat/sessions")); }

  useEffect(() => {
    if (!getToken()) { router.replace("/login"); return; }
    refreshSessions().catch(() => {});
  }, [router]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  async function openSession(id: string) {
    setSessionId(id); setError("");
    const data = await apiFetch<ChatMessage[]>(`/api/chat/sessions/${id}`);
    setMessages(data.map(m => ({ id: m.id, role: m.role, content: m.content, citations: m.citations || [] })));
  }

  function newChat() { setSessionId(null); setMessages([]); setInput(""); setError(""); }

  async function send(e: FormEvent) {
    e.preventDefault();
    const message = input.trim(); if (!message || loading) return;
    setInput(""); setError("");
    const optimistic: LocalMessage = { id: `u-${Date.now()}`, role: "user", content: message, citations: [] };
    setMessages(prev => [...prev, optimistic]); setLoading(true);
    try {
      const result = await apiFetch<{ session_id: string; answer: string; citations: Citation[]; route: string }>("/api/chat", {
        method: "POST", body: JSON.stringify({ message, session_id: sessionId })
      });
      setSessionId(result.session_id);
      setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: result.answer, citations: result.citations || [] }]);
      await refreshSessions();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not send message"); }
    finally { setLoading(false); }
  }

  function logout() { clearToken(); router.push("/login"); }

  return (
    <main className="chat-shell">
      <aside className="sidebar">
        <div className="brand sidebar-brand"><LogoMark className="brand-logo sidebar-logo" decorative /><span>Grounded DDI</span></div>
        <button className="new-chat" onClick={newChat}><span>＋</span> New conversation</button>
        <div className="session-list">
          <div className="sidebar-label">Recent conversations</div>
          {sessions.length === 0 && <div className="sidebar-empty">No saved conversations yet.</div>}
          {sessions.map(s => <button key={s.id} className={`session-item ${sessionId === s.id ? "active" : ""}`} onClick={() => openSession(s.id)}>{s.title}</button>)}
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-mini-status"><span className="status-dot" /> Evidence gate active</div>
          <button onClick={() => router.push("/onboarding")}>Edit profile</button>
          <button onClick={logout}>Log out</button>
        </div>
      </aside>

      <section className="chat-main">
        <header className="chat-header">
          <div className="chat-title-block"><strong>Medication Safety Assistant</strong><span>Grounded answers with source visibility</span></div>
          <div className="source-badges"><span>DDInter</span><span>EDA</span><span>Formulary</span><span>openFDA</span></div>
        </header>

        <div className="messages">
          {messages.length === 0 && (
            <div className="empty-state">
              <div className="empty-kicker"><span className="status-dot" /> Ready to check</div>
              <div className="empty-icon"><LogoMark className="empty-logo" decorative /></div>
              <h1>What would you like to check?</h1>
              <p>Ask about interactions, contraindications, side effects, monitoring, pregnancy, or other medication-safety topics.</p>
              <div className="prompt-cards">
                <button onClick={() => setInput("Can I take warfarin with aspirin?")}><span className="prompt-icon prompt-icon-teal">↔</span><div><strong>Check two drugs</strong><small>Interaction + severity</small></div></button>
                <button onClick={() => setInput("What are the contraindications of metformin?")}><span className="prompt-icon prompt-icon-blue">!</span><div><strong>Contraindications</strong><small>Safety restrictions</small></div></button>
                <button onClick={() => setInput("What are the side effects of amoxicillin?")}><span className="prompt-icon prompt-icon-amber">i</span><div><strong>Side effects</strong><small>Grounded adverse effects</small></div></button>
              </div>
            </div>
          )}
          {messages.map(m => <MessageBubble key={m.id} message={m} />)}
          {loading && <div className="assistant-row"><div className="assistant-avatar"><LogoMark className="avatar-logo" decorative /></div><div className="bubble assistant-bubble typing"><span></span><span></span><span></span></div></div>}
          {error && <div className="error-box chat-error">{error}</div>}
          <div ref={endRef} />
        </div>

        <div className="composer-wrap">
          <form className="composer" onSubmit={send}>
            <textarea value={input} onChange={e => setInput(e.target.value)} placeholder="Ask a medication-safety question…" rows={2} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
            <button disabled={loading || !input.trim()} aria-label="Send">↑</button>
            <div className="composer-note">Grounded in retrieved evidence · Not a substitute for professional medical advice</div>
          </form>
        </div>
      </section>
    </main>
  );
}

function MessageBubble({ message }: { message: LocalMessage }) {
  const [showSources, setShowSources] = useState(false);
  if (message.role === "user") return <div className="user-row"><div className="bubble user-bubble">{message.content}</div></div>;
  return (
    <div className="assistant-row">
      <div className="assistant-avatar"><LogoMark className="avatar-logo" decorative /></div>
      <div className="assistant-stack">
        <div className="bubble assistant-bubble"><pre>{message.content}</pre></div>
        {message.citations.length > 0 && <>
          <button className="source-toggle" onClick={() => setShowSources(v => !v)}>{showSources ? "Hide" : "Show"} {message.citations.length} source{message.citations.length === 1 ? "" : "s"} <span>{showSources ? "↑" : "↓"}</span></button>
          {showSources && <div className="source-list">{message.citations.map((c, i) => <article className="source-card" key={`${c.source_locator}-${i}`}><div className="source-top"><span>{c.source_type}</span><strong>{c.source_title}</strong></div><div className="source-locator">{c.section ? `${c.section} · ` : ""}{c.source_locator}</div><p>{c.snippet}</p></article>)}</div>}
        </>}
      </div>
    </div>
  );
}
