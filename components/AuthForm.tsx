"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, getToken, setToken } from "@/lib/api";
import styles from "./AuthForm.module.css";

type Mode = "login" | "signup";
type Theme = "light" | "dark";

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
  const [submitting, setSubmitting] = useState(false);
  const [switching, setSwitching] = useState(false);

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
    if (next === view || switching || submitting) return;
    setError("");
    setSwitching(true);
    setView(next);
    window.history.pushState({}, "", next === "login" ? "/login" : "/signup");
    window.setTimeout(() => setSwitching(false), 720);
  }

  async function submit(event: FormEvent, kind: Mode) {
    event.preventDefault();
    if (submitting || switching) return;
    setError("");

    if (kind === "signup" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/api/auth/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Authentication failed");

      setToken(body.access_token);
      router.replace(kind === "signup" || body.needs_onboarding ? "/onboarding" : "/chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  function form(kind: Mode) {
    const isLogin = kind === "login";
    return (
      <div className={styles.formBody}>
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

          <button className={styles.submit} type="submit" disabled={submitting || switching}>
            {isLogin ? "Log in" : "Create account"}
          </button>
        </form>

        <p className={styles.inlineSwitch} style={{ display: "block" }}>
          {isLogin ? "First time here? " : "Already have an account? "}
          <button type="button" onClick={() => switchMode(isLogin ? "signup" : "login")}>
            {isLogin ? "Sign up" : "Log in"}
          </button>
        </p>
      </div>
    );
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
            <h2>{isSignup ? "Welcome back." : "New to Hakeem?"}</h2>
            <p>
              {isSignup
                ? "Your medication conversations and saved context are ready when you are."
                : "Create an account to keep your conversations available across sessions."}
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
