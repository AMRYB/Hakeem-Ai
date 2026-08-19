"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, getToken, setToken } from "@/lib/api";
import HakeemLoader from "@/components/HakeemLoader";
import styles from "./AuthForm.module.css";

type Mode = "login" | "signup";
type Theme = "light" | "dark";

function PillIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m10.5 20.5 10-10a4.95 4.95 0 0 0-7-7l-10 10a4.95 4.95 0 0 0 7 7Z" />
      <path d="m8.5 8.5 7 7" />
    </svg>
  );
}

function savedTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const raw = localStorage.getItem("medchat-state-v1");
    if (raw) {
      const parsed = JSON.parse(raw);
      const value = parsed?.settings?.theme;
      if (value === "dark" || value === "light") return value;
    }
  } catch {
    // Fall through to the system preference.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [view, setView] = useState<Mode>(mode);
  const [theme, setTheme] = useState<Theme>("light");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [authComplete, setAuthComplete] = useState(false);

  useEffect(() => {
    setTheme(savedTheme());
    if (getToken()) {
      router.replace("/chat");
      return;
    }

    const syncFromHistory = () => {
      if (window.location.pathname === "/signup") setView("signup");
      if (window.location.pathname === "/login") setView("login");
    };
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, [router]);

  function switchMode(next: Mode) {
    if (next === view || switching || loading) return;
    setError("");
    setSwitching(true);
    setView(next);
    window.history.pushState({}, "", next === "login" ? "/login" : "/signup");
    window.setTimeout(() => setSwitching(false), 720);
  }

  async function submit(event: FormEvent, kind: Mode) {
    event.preventDefault();
    if (loading || switching) return;
    setError("");

    if (kind === "signup" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/auth/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Authentication failed");

      setToken(body.access_token);
      setAuthComplete(true);
      window.setTimeout(() => router.replace("/chat"), 850);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  function form(kind: Mode) {
    const isLogin = kind === "login";
    return (
      <div className={styles.formBody}>
        <div className={styles.brand}>
          <span className={styles.brandIcon}><PillIcon /></span>
          <span>Hakeem</span>
        </div>
        <div className={styles.eyebrow}>{isLogin ? "Welcome back" : "New account"}</div>
        <h1 className={styles.heading}>{isLogin ? "Log in" : "Sign up"}</h1>
        <p className={styles.subheading}>
          {isLogin
            ? "Continue to your medication-safety conversations."
            : "Create your account and start chatting with Hakeem."}
        </p>

        <form className={styles.form} onSubmit={(event) => submit(event, kind)}>
          <label className={styles.field}>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>

          <label className={styles.field}>
            <span>Password</span>
            <input
              type="password"
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              autoComplete={isLogin ? "current-password" : "new-password"}
              required
            />
          </label>

          {!isLogin && (
            <label className={styles.field}>
              <span>Confirm password</span>
              <input
                type="password"
                minLength={8}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Repeat your password"
                autoComplete="new-password"
                required
              />
            </label>
          )}

          {error && view === kind && <div className={styles.error}>{error}</div>}

          <button className={styles.submit} type="submit" disabled={loading || switching}>
            {loading && view === kind ? (isLogin ? "Signing in…" : "Creating account…") : (isLogin ? "Log in" : "Create account")}
          </button>
        </form>

        <p className={styles.inlineSwitch}>
          {isLogin ? "New to Hakeem? " : "Already have an account? "}
          <button type="button" onClick={() => switchMode(isLogin ? "signup" : "login")}>{isLogin ? "Sign up" : "Log in"}</button>
        </p>
      </div>
    );
  }

  if (authComplete) {
    return <HakeemLoader fullscreen theme={theme} label="Opening Hakeem…" />;
  }

  const isSignup = view === "signup";

  return (
    <main className={`${styles.shell} ${theme === "dark" ? styles.dark : ""}`}>
      <section className={`${styles.stage} ${isSignup ? styles.signupActive : ""}`} aria-label="Hakeem authentication">
        <section className={`${styles.formSide} ${styles.loginSide}`} aria-hidden={isSignup}>
          {form("login")}
        </section>

        <section className={`${styles.formSide} ${styles.signupSide}`} aria-hidden={!isSignup}>
          {form("signup")}
        </section>

        <aside className={styles.infoSlider}>
          <div className={styles.infoContent} key={view}>
            <div className={styles.infoPill}><PillIcon /></div>
            <h2>{isSignup ? "Welcome back." : "New to Hakeem?"}</h2>
            <p>
              {isSignup
                ? "Your medication conversations and saved context are ready when you are."
                : "Create an account to keep your conversations available across sessions."}
            </p>
            <button className={styles.switchButton} type="button" onClick={() => switchMode(isSignup ? "login" : "signup")}> 
              {isSignup ? "Log in" : "Create account"}
            </button>
          </div>
        </aside>

        {(switching || loading) && (
          <div className={styles.transitionOverlay}>
            <HakeemLoader
              theme={theme}
              label={loading ? (view === "login" ? "Signing in…" : "Creating account…") : "Switching…"}
            />
          </div>
        )}
      </section>
    </main>
  );
}
