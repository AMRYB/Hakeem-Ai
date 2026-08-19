"use client";

import {
  FormEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  apiFetch,
  ChatMessage,
  Citation,
  clearToken,
  getToken,
} from "@/lib/api";
import styles from "./chat.module.css";

type Session = {
  id: string;
  title: string;
  updated_at: string;
};

type Profile = {
  name: string;
  age: number;
  health_notes: string;
};

type LocalMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
};

type IconName =
  | "panel"
  | "plus"
  | "search"
  | "message"
  | "sparkles"
  | "more"
  | "send"
  | "mic"
  | "paperclip"
  | "copy"
  | "retry"
  | "chevron"
  | "user"
  | "logout"
  | "pill"
  | "activity"
  | "brain"
  | "thermometer"
  | "clock"
  | "shield";

const QUICK_PROMPTS = [
  {
    label: "I have a cold",
    prompt: "I have a cold. Are there any common cold medicines that can interact with other medications?",
    icon: "thermometer" as IconName,
  },
  {
    label: "My stomach hurts",
    prompt: "My stomach hurts. Could any common medicines or medication interactions make this worse?",
    icon: "activity" as IconName,
  },
  {
    label: "Severe headache",
    prompt: "I have a severe headache. What should I know about painkiller interactions before taking anything?",
    icon: "brain" as IconName,
  },
  {
    label: "Fever and fatigue",
    prompt: "I have fever and fatigue. What medication interactions should I be careful about with common fever medicines?",
    icon: "pill" as IconName,
  },
];

export default function ChatPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [openingSession, setOpeningSession] = useState(false);
  const [error, setError] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [profileName, setProfileName] = useState("Your account");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function refreshSessions() {
    const data = await apiFetch<Session[]>("/api/chat/sessions");
    setSessions(data);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }

    Promise.all([
      refreshSessions(),
      apiFetch<Profile | null>("/api/profile").then((profile) => {
        if (profile?.name?.trim()) setProfileName(profile.name.trim());
      }),
    ]).catch(() => {});
  }, [router]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, openingSession]);

  const visibleSessions = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();
    if (!normalized) return sessions;
    return sessions.filter((session) =>
      session.title.toLowerCase().includes(normalized),
    );
  }, [sessions, searchTerm]);

  const groupedSessions = useMemo(() => {
    const now = new Date();
    const todayKey = now.toDateString();
    const today: Session[] = [];
    const earlier: Session[] = [];

    visibleSessions.forEach((session) => {
      const updated = new Date(session.updated_at);
      if (!Number.isNaN(updated.getTime()) && updated.toDateString() === todayKey) {
        today.push(session);
      } else {
        earlier.push(session);
      }
    });

    return { today, earlier };
  }, [visibleSessions]);

  async function openSession(id: string) {
    if (loading || openingSession) return;
    setOpeningSession(true);
    setSessionId(id);
    setError("");
    try {
      const data = await apiFetch<ChatMessage[]>(`/api/chat/sessions/${id}`);
      setMessages(
        data.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          citations: message.citations || [],
        })),
      );
      setMobileSidebarOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open conversation");
    } finally {
      setOpeningSession(false);
    }
  }

  function newChat() {
    setSessionId(null);
    setMessages([]);
    setInput("");
    setError("");
    setToolsOpen(false);
    setMobileSidebarOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function submitMessage(message: string, appendUser = true) {
    const trimmed = message.trim();
    if (!trimmed || loading) return;

    setError("");
    setToolsOpen(false);

    if (appendUser) {
      setMessages((previous) => [
        ...previous,
        {
          id: `u-${Date.now()}`,
          role: "user",
          content: trimmed,
          citations: [],
        },
      ]);
    }

    setLoading(true);
    try {
      const result = await apiFetch<{
        session_id: string;
        answer: string;
        citations: Citation[];
        route: string;
      }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: trimmed, session_id: sessionId }),
      });

      setSessionId(result.session_id);
      setMessages((previous) => [
        ...previous,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: result.answer,
          citations: result.citations || [],
        },
      ]);
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send message");
    } finally {
      setLoading(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || loading) return;
    setInput("");
    await submitMessage(message, true);
  }

  function choosePrompt(prompt: string) {
    setInput(prompt);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function logout() {
    clearToken();
    router.push("/login");
  }

  const initial = profileName.trim().charAt(0).toUpperCase() || "U";
  const isEmpty = messages.length === 0 && !openingSession;

  return (
    <main
      className={`${styles.shell} ${sidebarCollapsed ? styles.sidebarCollapsed : ""}`}
      data-empty={isEmpty ? "true" : "false"}
    >
      <section className={styles.mainPanel}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button className={styles.iconButton} type="button" aria-label="More options" title="More options">
              <Icon name="more" />
            </button>
            <button className={styles.iconButton} type="button" aria-label="Conversation history" title="Conversation history">
              <Icon name="clock" />
            </button>
          </div>

          <button
            className={`${styles.iconButton} ${styles.mobileSidebarToggle}`}
            type="button"
            aria-label="Open conversations"
            onClick={() => setMobileSidebarOpen(true)}
          >
            <Icon name="panel" />
          </button>
        </header>

        <section className={styles.chatView}>
          <div className={styles.messageScroll}>
            {isEmpty && (
              <div className={styles.emptyState}>
                <h1>How are you feeling today?</h1>
                <p>
                  Tell Hakeem AI what you are taking or what you are worried about.
                  We will check medication-safety evidence before answering.
                </p>

                <div className={styles.suggestionGrid}>
                  {QUICK_PROMPTS.map((item) => (
                    <button key={item.label} type="button" onClick={() => choosePrompt(item.prompt)}>
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className={styles.thread}>
              {openingSession && (
                <div className={styles.loadingConversation}>Loading conversation…</div>
              )}

              {messages.map((message, index) => {
                const previousUser = findPreviousUserMessage(messages, index);
                return (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    previousUserMessage={previousUser}
                    onRegenerate={(value) => submitMessage(value, false)}
                    regenerateDisabled={loading}
                  />
                );
              })}

              {loading && (
                <div className={styles.assistantRow}>
                  <div className={styles.assistantAvatar}>
                    <Icon name="sparkles" />
                  </div>
                  <div className={styles.thinkingBlock}>
                    <span>Checking evidence</span>
                    <div className={styles.typingDots} aria-label="Hakeem AI is thinking">
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                </div>
              )}

              {error && <div className={styles.errorBox}>{error}</div>}
              <div ref={endRef} />
            </div>
          </div>

          <div className={`${styles.composerDock} ${isEmpty ? styles.composerDockEmpty : ""}`}>
            <form className={styles.composer} onSubmit={send}>
              <div className={styles.composerBox}>
                <div className={styles.toolsWrap}>
                  <button
                    className={styles.composerIconButton}
                    type="button"
                    aria-label="Open tools"
                    title="Tools"
                    aria-expanded={toolsOpen}
                    onClick={() => setToolsOpen((value) => !value)}
                  >
                    <Icon name="plus" />
                  </button>

                  {toolsOpen && (
                    <div className={styles.toolsMenu}>
                      <button type="button" onClick={() => router.push("/onboarding")}>
                        <Icon name="user" />
                        <span>Edit medication profile</span>
                      </button>
                      <button type="button" onClick={newChat}>
                        <Icon name="message" />
                        <span>Start a new chat</span>
                      </button>
                    </div>
                  )}
                </div>

                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Message Hakeem AI"
                  rows={1}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />

                <button
                  className={styles.composerIconButton}
                  type="button"
                  aria-label="Voice input"
                  title="Voice input"
                >
                  <Icon name="mic" />
                </button>

                <button
                  className={styles.sendButton}
                  type="submit"
                  disabled={loading || !input.trim()}
                  aria-label="Send message"
                  title="Send message"
                >
                  <Icon name="send" />
                </button>
              </div>
              <div className={styles.composerNote}>
                <Icon name="shield" />
                <span>Grounded medication-safety guidance with source citations</span>
              </div>
            </form>
          </div>
        </section>
      </section>

      <aside className={`${styles.sidebar} ${mobileSidebarOpen ? styles.mobileSidebarOpen : ""}`} aria-label="Conversation sidebar">
        <div className={styles.sidebarTop}>
          <button className={styles.brandButton} type="button" onClick={newChat} title="Hakeem AI">
            <span className={styles.brandMark}><Icon name="sparkles" /></span>
            <strong>Hakeem AI</strong>
          </button>

          <button
            className={styles.sidebarToggle}
            type="button"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            <Icon name="panel" />
          </button>
        </div>

        <button className={styles.newChatButton} type="button" onClick={newChat}>
          <Icon name="message" />
          <span>New chat</span>
          <Icon name="plus" />
        </button>

        <button
          className={styles.searchButton}
          type="button"
          onClick={() => setSearchOpen((value) => !value)}
        >
          <Icon name="search" />
          <span>Search conversations</span>
        </button>

        {searchOpen && !sidebarCollapsed && (
          <div className={styles.searchField}>
            <Icon name="search" />
            <input
              autoFocus
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search chats"
              type="search"
            />
          </div>
        )}

        <div className={styles.sessionList}>
          {visibleSessions.length === 0 && !sidebarCollapsed && (
            <div className={styles.sidebarEmpty}>
              {searchTerm ? "No conversations found." : "Your conversations will appear here."}
            </div>
          )}

          <SessionGroup
            label="Today"
            sessions={groupedSessions.today}
            activeId={sessionId}
            collapsed={sidebarCollapsed}
            onOpen={openSession}
          />
          <SessionGroup
            label="Earlier"
            sessions={groupedSessions.earlier}
            activeId={sessionId}
            collapsed={sidebarCollapsed}
            onOpen={openSession}
          />
        </div>

        <div className={styles.sidebarBottom}>
          <button className={styles.profileButton} type="button" onClick={() => router.push("/onboarding")}>
            <span className={styles.avatar}>{initial}</span>
            <span className={styles.profileCopy}>
              <strong>{profileName}</strong>
              <small>Medication profile</small>
            </span>
            <Icon name="more" />
          </button>

          <button className={styles.logoutButton} type="button" onClick={logout} title="Log out">
            <Icon name="logout" />
            <span>Log out</span>
          </button>
        </div>
      </aside>

      {mobileSidebarOpen && (
        <button
          className={styles.mobileOverlay}
          type="button"
          aria-label="Close conversations"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
    </main>
  );
}

function SessionGroup({
  label,
  sessions,
  activeId,
  collapsed,
  onOpen,
}: {
  label: string;
  sessions: Session[];
  activeId: string | null;
  collapsed: boolean;
  onOpen: (id: string) => void;
}) {
  if (sessions.length === 0) return null;

  return (
    <div className={styles.sessionGroup}>
      {!collapsed && <h3>{label}</h3>}
      {sessions.map((session) => (
        <button
          key={session.id}
          type="button"
          className={`${styles.sessionItem} ${activeId === session.id ? styles.sessionItemActive : ""}`}
          onClick={() => onOpen(session.id)}
          title={session.title}
        >
          <Icon name="message" />
          {!collapsed && <span>{session.title || "Untitled conversation"}</span>}
          {!collapsed && <Icon name="more" />}
        </button>
      ))}
    </div>
  );
}

function MessageBubble({
  message,
  previousUserMessage,
  onRegenerate,
  regenerateDisabled,
}: {
  message: LocalMessage;
  previousUserMessage: string;
  onRegenerate: (message: string) => void;
  regenerateDisabled: boolean;
}) {
  const [showSources, setShowSources] = useState(false);
  const [copied, setCopied] = useState(false);

  if (message.role === "user") {
    return (
      <div className={styles.userRow}>
        <div className={styles.userBubble}>{message.content}</div>
      </div>
    );
  }

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={styles.assistantRow}>
      <div className={styles.assistantAvatar}>
        <Icon name="sparkles" />
      </div>

      <div className={styles.assistantStack}>
        <div className={styles.assistantContent}>
          <RichText text={message.content} />
        </div>

        <div className={styles.responseActions}>
          <button type="button" onClick={copyAnswer} title="Copy response" aria-label="Copy response">
            <Icon name="copy" />
            {copied && <span>Copied</span>}
          </button>

          {previousUserMessage && (
            <button
              type="button"
              onClick={() => onRegenerate(previousUserMessage)}
              disabled={regenerateDisabled}
              title="Regenerate response"
              aria-label="Regenerate response"
            >
              <Icon name="retry" />
            </button>
          )}

          {message.citations.length > 0 && (
            <button
              className={styles.sourcesButton}
              type="button"
              onClick={() => setShowSources((value) => !value)}
            >
              <Icon name="paperclip" />
              <span>{message.citations.length} source{message.citations.length === 1 ? "" : "s"}</span>
              <Icon name="chevron" />
            </button>
          )}
        </div>

        {showSources && message.citations.length > 0 && (
          <div className={styles.sourceList}>
            {message.citations.map((citation, index) => (
              <article className={styles.sourceCard} key={`${citation.source_locator}-${index}`}>
                <div className={styles.sourceHeader}>
                  <span>{citation.source_type}</span>
                  <strong>{citation.source_title}</strong>
                </div>
                <div className={styles.sourceLocator}>
                  {citation.section ? `${citation.section} · ` : ""}
                  {citation.source_locator}
                </div>
                <p>{citation.snippet}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RichText({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");

  return (
    <div className={styles.richText}>
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div className={styles.lineGap} key={`gap-${index}`} />;
        if (/^---+$/.test(trimmed)) return <hr key={`hr-${index}`} />;

        const headingMatch = trimmed.match(/^#{1,3}\s+(.+)$/);
        if (headingMatch) {
          return <h3 key={`h-${index}`}>{renderInline(headingMatch[1])}</h3>;
        }

        const bulletMatch = trimmed.match(/^[-*•]\s+(.+)$/);
        if (bulletMatch) {
          return (
            <div className={styles.richBullet} key={`b-${index}`}>
              <span>•</span>
              <p>{renderInline(bulletMatch[1])}</p>
            </div>
          );
        }

        const numberedMatch = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
        if (numberedMatch) {
          return (
            <div className={styles.richBullet} key={`n-${index}`}>
              <span>{numberedMatch[1]}.</span>
              <p>{renderInline(numberedMatch[2])}</p>
            </div>
          );
        }

        return <p key={`p-${index}`}>{renderInline(trimmed)}</p>;
      })}
    </div>
  );
}

function renderInline(text: string): ReactNode[] {
  const chunks = text.split(/(\*\*[^*]+\*\*)/g);
  return chunks.map((chunk, index) => {
    if (chunk.startsWith("**") && chunk.endsWith("**")) {
      return <strong key={index}>{chunk.slice(2, -2)}</strong>;
    }
    return <span key={index}>{chunk}</span>;
  });
}

function findPreviousUserMessage(messages: LocalMessage[], index: number) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (messages[cursor].role === "user") return messages[cursor].content;
  }
  return "";
}

function Icon({ name }: { name: IconName }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  const paths: Record<IconName, ReactNode> = {
    panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></>,
    message: <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /></>,
    sparkles: <><path d="m12 3-1.1 3.1A3 3 0 0 1 9 8l-3 1 3 1.1a3 3 0 0 1 1.9 1.9l1.1 3 1.1-3a3 3 0 0 1 1.9-1.9L18 9l-3-1a3 3 0 0 1-1.9-1.9z" /><path d="m19 15-.6 1.6a2 2 0 0 1-1.2 1.2l-1.6.6 1.6.6a2 2 0 0 1 1.2 1.2L19 22l.6-1.8a2 2 0 0 1 1.2-1.2l1.6-.6-1.6-.6a2 2 0 0 1-1.2-1.2z" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
    send: <><path d="m5 12 14-7-4 14-3-5z" /><path d="m12 14 7-9" /></>,
    mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></>,
    paperclip: <><path d="m20.5 11.5-8.9 8.9a5 5 0 0 1-7.1-7.1l9.6-9.6a3.5 3.5 0 0 1 5 5l-9.6 9.6a2 2 0 0 1-2.8-2.8l8.9-8.9" /></>,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" /></>,
    retry: <><path d="M20 7v5h-5" /><path d="M19 12a7 7 0 1 0-2 5" /></>,
    chevron: <><path d="m9 10 3 3 3-3" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    logout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M21 19V5a2 2 0 0 0-2-2h-5" /></>,
    pill: <><path d="M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 1 1-7 7Z" /><path d="m8 9 7 7" /></>,
    activity: <><path d="M3 12h4l2-6 4 12 2-6h6" /></>,
    brain: <><path d="M9.5 4A3.5 3.5 0 0 0 6 7.5v.2A3.5 3.5 0 0 0 4 11a3.5 3.5 0 0 0 2 3.2v.3A3.5 3.5 0 0 0 9.5 18H11V4Z" /><path d="M14.5 4A3.5 3.5 0 0 1 18 7.5v.2a3.5 3.5 0 0 1 2 3.3 3.5 3.5 0 0 1-2 3.2v.3a3.5 3.5 0 0 1-3.5 3.5H13V4Z" /><path d="M8 10h3M13 14h3" /></>,
    thermometer: <><path d="M14 14.8V5a4 4 0 0 0-8 0v9.8a6 6 0 1 0 8 0Z" /><path d="M10 9v7" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>,
  };

  return <svg {...common}>{paths[name]}</svg>;
}
