import Link from "next/link";
import LogoMark from "@/components/LogoMark";

export default function Home() {
  return (
    <main className="landing-shell">
      <nav className="topbar">
        <div className="brand"><LogoMark className="brand-logo" decorative /><span>Grounded DDI</span></div>
        <div className="nav-actions">
          <Link className="ghost-btn" href="/login">Log in</Link>
          <Link className="primary-btn" href="/signup">Get started</Link>
        </div>
      </nav>

      <section className="hero hero-grid">
        <div className="hero-content">
          <div className="eyebrow">Evidence-first medication safety</div>
          <h1>Safer medication answers, grounded in real evidence.</h1>
          <p className="hero-copy">
            Check drug interactions, contraindications, warnings, pregnancy considerations, and more — with answers tied to DDInter, Egyptian formulary sources, EDA monographs, and openFDA.
          </p>
          <div className="hero-actions">
            <Link className="primary-btn large" href="/signup">Start checking safely</Link>
            <Link className="ghost-btn large" href="/login">Log in</Link>
          </div>
          <div className="trust-row">
            <span><i className="trust-dot" /> Grounded answers</span>
            <span><i className="trust-dot" /> Safety-gated</span>
            <span><i className="trust-dot" /> Sources shown</span>
          </div>
        </div>

        <div className="hero-panel" aria-label="Example grounded medication answer">
          <div className="hero-panel-top">
            <div>
              <span className="mini-label">Example check</span>
              <strong>Warfarin + Aspirin</strong>
            </div>
            <span className="severity-pill">Major</span>
          </div>
          <div className="answer-preview">
            <div className="answer-preview-icon"><LogoMark className="preview-logo" decorative /></div>
            <div>
              <p className="preview-title">Interaction found</p>
              <p className="preview-copy">The pair is documented as a major interaction. The assistant shows only what the retrieved evidence supports.</p>
            </div>
          </div>
          <div className="evidence-strip">
            <span>DDInter</span><span>EDA</span><span>Formulary</span><span>openFDA</span>
          </div>
          <div className="preview-source">
            <span>Evidence source</span>
            <strong>Egyptian National Drug Formulary</strong>
          </div>
        </div>
      </section>

      <section className="feature-section">
        <div className="section-heading">
          <div className="eyebrow">Built for trust</div>
          <h2>Simple on the surface. Strict underneath.</h2>
        </div>
        <div className="feature-grid">
          <article className="feature-card feature-teal"><span className="feature-number">01</span><h3>DDInter first</h3><p>Two-drug questions hit the explicit interaction table before semantic retrieval.</p></article>
          <article className="feature-card feature-blue"><span className="feature-number">02</span><h3>Safety gate</h3><p>Urgent symptom patterns bypass normal RAG and switch to safety-first guidance.</p></article>
          <article className="feature-card feature-amber"><span className="feature-number">03</span><h3>No evidence, no answer</h3><p>Weak evidence is rejected instead of letting the model guess or improvise.</p></article>
        </div>
      </section>

      <footer className="landing-footer">
        <span className="footer-brand"><LogoMark className="footer-logo" decorative /> Grounded DDI</span>
        <span>Research / decision-support prototype · Not a substitute for professional medical advice.</span>
      </footer>
    </main>
  );
}
