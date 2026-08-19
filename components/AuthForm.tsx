"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { API_BASE, setToken } from "@/lib/api";
import LogoMark from "@/components/LogoMark";

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const response = await fetch(`${API_BASE}/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Authentication failed");
      setToken(body.access_token);
      router.push(body.needs_onboarding ? "/onboarding" : "/chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally { setLoading(false); }
  }

  const isLogin = mode === "login";
  return (
    <div className="auth-layout">
      <aside className="auth-aside">
        <Link className="brand auth-aside-brand" href="/"><LogoMark className="brand-logo" decorative /> Grounded DDI</Link>
        <div className="auth-aside-copy">
          <div className="eyebrow light-eyebrow">Medication safety workspace</div>
          <h2>{isLogin ? "Welcome back to evidence-first answers." : "Start with evidence, not guesswork."}</h2>
          <p>{isLogin ? "Your sessions, profile, and grounded medication checks are ready when you are." : "Create an account to keep your profile and chat history isolated while the assistant stays grounded in approved sources."}</p>
        </div>
        <div className="auth-benefits">
          <div><span>✓</span><p><strong>Grounded retrieval</strong><small>Answers are tied to retrieved evidence.</small></p></div>
          <div><span>✓</span><p><strong>Private profile context</strong><small>Relevant health context can inform personal questions.</small></p></div>
          <div><span>✓</span><p><strong>Visible sources</strong><small>See where an answer came from.</small></p></div>
        </div>
      </aside>

      <div className="auth-card auth-card-modern">
        <Link className="brand auth-mobile-brand" href="/"><LogoMark className="brand-logo" decorative /> Grounded DDI</Link>
        <div className="auth-heading">
          <div className="eyebrow">{isLogin ? "Welcome back" : "Create your account"}</div>
          <h1>{isLogin ? "Log in" : "Get started"}</h1>
          <p>{isLogin ? "Continue to your medication-safety workspace." : "Set up your account in a few seconds."}</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com" /></label>
          <label>Password<input type="password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} required autoComplete={isLogin ? "current-password" : "new-password"} placeholder="At least 8 characters" /></label>
          {error && <div className="error-box">{error}</div>}
          <button className="primary-btn full auth-submit" disabled={loading}>{loading ? "Working…" : (isLogin ? "Log in" : "Create account")}</button>
        </form>
        <p className="auth-switch">{isLogin ? "New here?" : "Already have an account?"} <Link href={isLogin ? "/signup" : "/login"}>{isLogin ? "Create one" : "Log in"}</Link></p>
      </div>
    </div>
  );
}
