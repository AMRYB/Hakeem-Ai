"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "@/lib/api";
import LogoMark from "@/components/LogoMark";

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (!getToken()) router.replace("/login"); }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setLoading(true); setError("");
    try {
      await apiFetch("/api/profile", { method: "PUT", body: JSON.stringify({ name, age: Number(age), health_notes: notes }) });
      router.push("/chat");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save profile"); }
    finally { setLoading(false); }
  }

  return (
    <main className="auth-shell onboarding-shell">
      <div className="onboarding-layout">
        <aside className="onboarding-aside">
          <Link className="brand" href="/"><LogoMark className="brand-logo" decorative /> Grounded DDI</Link>
          <div>
            <div className="eyebrow light-eyebrow">One-time setup</div>
            <h2>Give the assistant the context that actually matters.</h2>
            <p>Your profile is encrypted at rest. Only relevant context is considered when you ask a personal medication-safety question.</p>
          </div>
          <div className="profile-tip-card">
            <span>Good to include</span>
            <p>Allergies · Current medications · Long-term conditions · Pregnancy status</p>
          </div>
        </aside>

        <div className="auth-card onboarding-card">
          <div className="auth-heading">
            <div className="eyebrow">Your profile</div>
            <h1>What should the assistant consider?</h1>
            <p>You can edit this later from the chat sidebar.</p>
          </div>
          <form className="auth-form" onSubmit={submit}>
            <div className="form-row">
              <label>Name<input value={name} onChange={e => setName(e.target.value)} required maxLength={120} placeholder="Your name" /></label>
              <label>Age<input type="number" min={0} max={120} value={age} onChange={e => setAge(e.target.value)} required placeholder="Age" /></label>
            </div>
            <label>Optional health notes<textarea rows={6} value={notes} onChange={e => setNotes(e.target.value)} maxLength={4000} placeholder="e.g. Asthma, penicillin allergy, currently taking aspirin…" /></label>
            <div className="privacy-note"><span>🔒</span><p><strong>Encrypted profile</strong><small>Only context relevant to the current question is passed into the answer workflow.</small></p></div>
            {error && <div className="error-box">{error}</div>}
            <button className="primary-btn full auth-submit" disabled={loading}>{loading ? "Saving…" : "Continue to chat"}</button>
          </form>
        </div>
      </div>
    </main>
  );
}
