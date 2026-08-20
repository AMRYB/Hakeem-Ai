"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "@/lib/api";
import styles from "./Onboarding.module.css";

type Theme = "light" | "dark";

function readTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const raw = localStorage.getItem("medchat-state-v1");
    if (raw) {
      const theme = JSON.parse(raw)?.settings?.theme;
      if (theme === "light" || theme === "dark") return theme;
    }
  } catch {
    // Use system preference below.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function OnboardingPage() {
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>("light");
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTheme(readTheme());
    if (!getToken()) router.replace("/signup");
  }, [router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");

    try {
      await apiFetch("/api/profile", {
        method: "PUT",
        body: JSON.stringify({
          name: name.trim(),
          age: Number(age),
          health_notes: notes.trim(),
        }),
      });
      router.replace("/chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your profile");
      setSaving(false);
    }
  }

  return (
    <main className={`${styles.shell} ${theme === "dark" ? styles.dark : ""}`}>
      <section className={styles.card}>
        <div className={styles.step}>One-time setup</div>
        <h1 className={styles.heading}>Before we start, tell me about you.</h1>
        <p className={styles.intro}>
          This helps Hakeem use the right context when answering medication-safety questions. You only need to do this once.
        </p>

        <form className={styles.form} onSubmit={submit}>
          <div className={styles.row}>
            <label className={styles.field}>
              <span>What’s your name?</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={120}
                autoComplete="name"
                placeholder="Your name"
              />
            </label>

            <label className={styles.field}>
              <span>How old are you?</span>
              <input
                type="number"
                min={1}
                max={120}
                value={age}
                onChange={(event) => setAge(event.target.value)}
                required
                inputMode="numeric"
                placeholder="Age"
              />
            </label>
          </div>

          <label className={styles.field}>
            <span>Are you currently dealing with anything?</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={4000}
              placeholder="For example: asthma, an allergy, a current symptom, or medicines you take regularly…"
            />
          </label>
          <p className={styles.help}>Optional — leave it blank if there is nothing you want Hakeem to consider right now.</p>

          <div className={styles.privacy}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect width="18" height="11" x="3" y="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span>Your profile is encrypted and is used only as relevant context for your medication-safety conversations.</span>
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <button className={styles.submit} type="submit" disabled={saving}>
            Continue to chat
          </button>
        </form>
      </section>
    </main>
  );
}
