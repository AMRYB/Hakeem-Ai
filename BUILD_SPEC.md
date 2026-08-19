# Build Spec: Drug-Drug Interaction (DDI) Assistant — Deployable Web App

Paste this entire document as your prompt. It describes a complete, deployable
system: a login-gated web app with a chat assistant that answers drug
interaction and medication-safety questions **strictly from provided data
sources plus the FDA API**, with no hallucination, a deterministic safety
gate, hybrid retrieval, and mechanism-aware reasoning.

---

## 1. Data sources (what "grounded" means here)

The system has three data sources, and must never answer from anything else:

1. **`eda_all_drug_monographs.csv`** — ~480 structured drug monographs
   (columns: `generic_name`, `dosage_forms_strengths`,
   `route_of_administration`, `pharmacologic_category`, `atc_code`,
   `indications`, `dosage_regimen`, `dosage_adjustment`, `contraindications`,
   `adverse_reactions`, `monitoring_parameters`, `drug_interactions`,
   `pregnancy_lactation`, `administration`, `warnings_precautions`,
   `storage`, plus `raw_monograph_text` — the full original text, which is
   often the only place structured fields are actually populated).
2. **DDInter pairwise interaction files** (`ddinter_downloads_code_*.csv`,
   split A–V by drug initial) — explicit, structured pairwise interactions:
   `DDInterID_A, Drug_A, DDInterID_B, Drug_B, Level` where `Level` is one of
   `Minor / Moderate / Major / Unknown`. ~1,700+ unique drugs. This is your
   fastest, least ambiguous source for "can I take X with Y" — always check
   this FIRST for any two-drug question, before falling back to unstructured
   monograph text.
3. **Egyptian National Formulary PDFs** (multiple, split by drug class:
   antimicrobial, cardiovascular, antiretroviral, respiratory, anticancer,
   endocrine, blood disorders, nervous system, targeted medicines, general).
   Use for narrative content: dosing, pregnancy/lactation guidance,
   contraindications, monitoring — anything not captured in DDInter's
   pairwise table.
4. **FDA API** (openFDA — `https://api.fda.gov/drug/label.json` and
   `/drug/event.json`) — call this live for anything not found in the three
   local sources above (e.g. a drug not present locally, or to supplement
   with official FDA label warnings/adverse events). Treat FDA API results
   with the same strict grounding rule as local data: cite it, don't
   paraphrase beyond recognition, and never blend it with LLM prior
   knowledge.

**Golden rule, no exceptions:** if a fact isn't found in one of these four
sources, the system says so explicitly — e.g. *"I don't have information on
this in the provided data or the FDA database. Please consult a pharmacist
or physician."* Never fill gaps with the LLM's own training knowledge. This
must be enforced by the prompt AND spot-checked by the accuracy function
(Section 7).

---

## 2. Architecture (keep it simple — this is a hard constraint)

Simple, boring, and correct beats clever. Use this stack unless you have a
specific reason not to:

- **Backend:** Python, FastAPI
- **Frontend:** a single lightweight framework (Next.js or plain
  React+Vite) — one landing/login page, one chat page. No microservices,
  no message queues, no Kubernetes. A monolith is fine for this scope.
- **Auth + user data storage:** Postgres (or SQLite for a first pass),
  with passwords hashed via bcrypt/argon2, sessions via signed JWT or
  server-side sessions — pick one, don't build both.
- **Vector store:** Chroma (local, matches your existing notebook) or
  pgvector if you want everything in one database. Don't introduce a
  separate hosted vector DB unless deploying at real scale.
- **Embeddings:** a biomedical sentence embedding model (e.g.
  PubMedBERT-based, matching what the existing notebook uses) for the
  local corpus; keep the same model for query-time embedding.
- **LLM:** whatever the deployment target supports (local Ollama model,
  or a hosted API) — architecture should not hard-code one provider;
  wrap it behind a single `generate(prompt) -> text` function so it's
  swappable.
- **Reranker:** a lightweight cross-encoder reranker (e.g.
  `cross-encoder/ms-marco-MiniLM-L-6-v2` or a biomedical cross-encoder if
  available) run on the top-N hybrid search results before they go to the
  LLM.

Do not add features not listed in this document. If something isn't
specified, prefer the simplest correct implementation.

---

## 3. Retrieval pipeline

### 3.1 Context-aware chunking

- Chunk each formulary PDF/CSV monograph by its own section headers
  (e.g. "Drug Interactions", "Contraindications", "Pregnancy and
  Lactation", "Dosage Regimen", "Warnings/Precautions") rather than by
  fixed character count. Store the section name in chunk metadata.
- Store `generic_name` (and `source_title` / `source_pdf` / page number)
  in metadata for every chunk so retrieval can filter by drug and every
  answer can cite an exact, verifiable source.
- For DDInter rows, each pairwise interaction is already a clean,
  minimal unit — treat each row as its own retrievable record; no
  further chunking needed. Index `Drug_A`, `Drug_B`, and `Level` as
  structured metadata plus a synthesized sentence (e.g. *"Naltrexone and
  Abacavir: Moderate interaction risk."*) as the embedded text.

### 3.2 Hybrid search

For every retrieval, combine:

- **Dense (semantic) search** over the embedded chunks/DDInter records
  — for paraphrased or descriptive questions ("what happens if I add
  ibuprofen to warfarin").
- **Sparse/lexical search** (BM25, or Postgres full-text search, or
  a simple keyword/metadata filter) — for exact drug-name matching,
  since drug names are proper nouns that dense embeddings sometimes
  under-rank against similar-sounding or thematically-similar text.

Merge dense + sparse results (e.g. reciprocal rank fusion), then pass
the merged candidate set to reranking.

**Known bug to avoid (from the earlier prototype):** when a question
names two drugs, do not rely purely on embedding similarity to the raw
question to surface the interaction-relevant chunk — this silently
dropped the right section in testing. Instead, for every drug named in
the question, ALWAYS force-include: (a) any DDInter row where that drug
appears as `Drug_A` or `Drug_B` alongside the other named drug, and
(b) that drug's "Drug Interactions"/"Contraindications" formulary
section — regardless of how the question is phrased. Don't leave this
to chance via top-k similarity alone.

### 3.3 Reranking

- Take the top ~20–30 hybrid search candidates.
- Rerank with a cross-encoder against the literal user question.
- Keep the top ~5–8 reranked chunks as final context.
- Log the reranker's scores; if the top score is below a configurable
  threshold, treat this as "no strong evidence found" and route to the
  refusal template rather than forcing an answer from weak matches.

### 3.4 Drug-name extraction

- Maintain a `known_drug_names` set built from BOTH the formulary CSV's
  `generic_name` column AND all unique drug names across the DDInter
  files (~1,700+ names — a much larger and more useful vocabulary than
  the formulary alone).
- Use word-boundary regex matching against this set to detect which
  drugs are named in a question. This detection result feeds both
  retrieval (Section 3.2) and intent detection (Section 5).

---

## 4. Accuracy / grounding-check function

Implement a function that checks retrieval quality and flags weak
grounding **before** the answer is generated (not after) — deterministic,
no LLM call needed:

```python
def score_retrieval_confidence(question, retrieved_chunks, reranker_scores):
    """
    Returns a confidence score and a boolean "should_refuse_for_low_confidence" flag.

    Checks:
    - Are all drugs named in the question actually present as metadata
      (generic_name / Drug_A / Drug_B) on at least one retrieved chunk?
      If a named drug has zero matching chunks, that's a hard signal to
      refuse rather than let the LLM improvise.
    - Is the top reranker score above the configured threshold?
    - For two-drug questions: does at least one retrieved chunk/DDInter
      row contain BOTH drug names together (not just each drug
      separately in unrelated chunks)? This directly prevents the
      "thematic similarity" hallucination bug seen in testing (e.g.
      Drug A's nephrotoxicity list + Drug B's unrelated renal-dosing
      section getting merged into a fabricated interaction).
    """
```

Use this as a **hard gate**: if it returns `should_refuse_for_low_confidence
= True`, skip the LLM generation step entirely and return the standard
refusal message. This makes "don't hallucinate" enforceable by code, not
just by prompt instruction (prompt instructions alone were shown to be
insufficient in testing — the LLM both under- and over-answered at
different times depending on prompt wording).

---

## 5. Mechanism-aware reasoning (Phase 16)

When — and only when — the retrieved evidence supports it, structure
interaction explanations along a pharmacological chain:

```
Drug A → Enzyme / transporter / target → Drug B → Potential interaction
```

Rules:

- Every mechanism claim must cite the specific retrieved chunk/DDInter
  row that supports it (pharmacokinetic reasoning: e.g. shared CYP
  enzyme, transporter; or pharmacodynamic reasoning: e.g. additive
  toxicity, opposing effects).
- **The LLM must never generate a mechanism that isn't explicitly
  present in the retrieved context.** If the data only says "Risk X:
  Avoid combination" with no stated mechanism, the answer must present
  the interaction and its severity level without inventing a
  pharmacological explanation. It's acceptable — and required — to say
  "mechanism not specified in the available data" rather than guess.
- This reasoning structure is a formatting/explanation layer on top of
  retrieved facts, not a new source of facts.

---

## 6. Deterministic Safety Gate (mandatory, runs before everything else)

This is the highest-priority component. Do not rely on the LLM to catch
emergencies — build a dedicated, deterministic detector that runs before
drug-name extraction and before normal RAG retrieval.

```python
def detect_safety_signal(query: str) -> dict:
    """
    Deterministic, pattern-based (not LLM-based) urgent-symptom detector.
    Runs FIRST, before drug extraction and before RAG retrieval.

    Returns:
        {
            "is_urgent": bool,
            "matched_patterns": [...],  # for logging/audit, not shown to user
            "category": str | None,     # e.g. "bleeding", "allergic_reaction", "breathing"
        }
    """
```

Requirements:

- Vocabulary/patterns must be **configurable** (e.g. a YAML/JSON file or
  DB table), not hard-coded inline inside `rag_query()` or any single
  function — so new patterns can be added without a code deploy.
- Cover at minimum: unusual/severe/heavy bleeding, vomiting blood, blood
  in stool, black/tarry stool, difficulty/trouble breathing, severe
  allergic reaction, swelling of face/throat, loss of consciousness,
  seizure, overdose, severe chest pain, and a general "severe symptoms"
  catch-all category — but structure it as an extensible list, not a
  fixed set.
- Match on the **symptom description**, not on drug names — a query
  naming zero drugs can still trigger this (e.g. "I feel dizzy").
- **If triggered:** skip normal DDI retrieval/generation entirely for
  this turn. Return a cautious, non-diagnostic response that:
  - Acknowledges the described symptom as potentially urgent.
  - Recommends seeking urgent/emergency medical care.
  - Explicitly does not attempt to diagnose or explain the symptom's
    cause.
  - States clearly this system is not a substitute for professional
    medical care.
  - Still logs the interaction (for the user's own record and for
    audit), but does not proceed to retrieve or reason about drug
    interactions in that same turn.
- **Test this specific case, since it previously scored 0% accuracy:**
  *"I am taking warfarin and I have unusual bleeding. What should I
  do?"* — this must trigger the safety gate, not be treated as a normal
  DDI lookup about warfarin.
- The safety gate is about **routing**, not diagnosis. Never let the
  LLM produce content that sounds like a clinical diagnosis or specific
  treatment instruction in this path.

---

## 7. Intent detection

Before retrieval, classify the incoming message into one of:

- `ddi_query` — "can I take X with Y", "interaction between X and Y"
- `single_drug_info` — "what are the side effects of X", "what is X"
- `patient_context_query` — "can I take X if I have kidney problems /
  am pregnant / have liver disease" — these require pulling the
  relevant monograph fields (`contraindications`,
  `dosage_adjustment`, `pregnancy_lactation`) rather than just DDInter.
- `multi_drug_query` — 3+ drugs named; check all pairwise combinations
  against DDInter, not just adjacent pairs.
- `general_knowledge` — "what is a drug interaction", not tied to a
  specific drug; answer from PDFs/general context, don't force the
  drug-interaction answer template.
- `unsafe_symptom` — handled entirely by the Safety Gate (Section 6)
  before intent detection even runs; if the safety gate fires, intent
  detection is skipped for that turn.
- `unknown_drug` — question names something not found in
  `known_drug_names` at all; respond that this specific drug isn't in
  the available data, and optionally suggest checking the FDA API
  live before refusing outright.

Intent detection can be a simple deterministic classifier (keyword/regex
+ the drug-extraction results) rather than an LLM call — keep it fast,
predictable, and cheap. Only use the LLM for the final answer
generation step, not for routing.

---

## 8. Conversation memory

- Maintain the **last 6 question/answer turns** per user session,
  stored server-side (tied to their authenticated session), and include
  a condensed version of that history in the prompt context so the
  assistant can resolve references like "and what about with aspirin
  too?" after a prior turn about warfarin.
- Memory is per-user and per-session; never leak one user's
  conversation history into another user's context.
- Memory does NOT bypass the Safety Gate or the grounding rules — even
  with prior context, every new factual claim must still trace to
  retrieved evidence from that turn.

---

## 9. User onboarding, accounts, and data handling

### 9.1 Landing page + login

- Simple landing page → sign up / log in (email + password, hashed).
- On first login (or first chat), collect: name, age, and "anything
  else the assistant should take into consideration" (free-text field
  for allergies, conditions, current medications — optional).
- This profile data is stored once and referenced in later
  conversations (e.g. so "can I take this if I'm pregnant" can use a
  previously-stated pregnancy status if the user already provided it,
  without re-asking every turn) — but the assistant must always ask
  again for anything safety-critical it isn't confident about rather
  than assuming.

### 9.2 Security for patient data

- Store name/age/health notes encrypted at rest (e.g. Postgres column-level
  encryption, or an application-layer encryption library) — not plaintext.
- Never include raw patient-identifying fields (name, exact age if
  treated as sensitive) in logs, error messages, or any LLM prompt
  unless the field is specifically relevant to answering the current
  question (e.g. "pregnant" is relevant to a pregnancy-related dosing
  question; the user's name is not relevant to any drug question and
  should never be sent to the LLM).
- Enforce authentication on every API route that touches user data or
  chat history; no anonymous access to another user's data, ever.
- Follow basic security hygiene: HTTPS only, hashed passwords
  (bcrypt/argon2, never plaintext or reversible encryption for
  passwords), parameterized DB queries (no string-built SQL), rate
  limiting on login and chat endpoints, and CSRF protection on any
  cookie-based session.

---

## 10. Answer format (for DDI questions)

Keep the structure already validated as working:

```
- Interaction: <summary, grounded in retrieved evidence>
- Mechanism (if evidence supports it): Drug A → [enzyme/transporter/target] → Drug B
- Severity / Risk level: <exactly as stated in source — e.g. DDInter's
  Minor/Moderate/Major/Unknown, or the formulary's Risk X/D label>
- Clinical recommendation: <exactly as stated in source>
- Source: <exact citation — DDInter row, or [Source: Drug - Formulary
  Document (Section)], or FDA API reference>
This is not a substitute for professional medical advice.
```

If nothing relevant is found: return the refusal message exactly, and
nothing else — no partial guesses, no "it's possible that...".

---

## 11. What "done" looks like — required test coverage before deployment

Build these as automated tests, not just manual spot checks:

1. **Retrieval tests** — for a sample of real DDInter pairs, confirm
   the pipeline retrieves the correct row/chunk.
2. **True-positive generation tests** — known real interactions (pull
   several `Major` severity pairs from DDInter) must NOT be refused.
3. **True-negative generation tests** — two real drugs from the data
   with NO documented interaction between them must be refused, not
   have an interaction fabricated from thematic similarity (this exact
   failure mode was caught in earlier testing — e.g. two drugs that
   both happen to relate to kidney function, but never co-occur in any
   source, must not be treated as interacting).
4. **Safety gate tests** — the full "unusual bleeding on warfarin"
   style query set must all route to the safety path, not the normal
   DDI path. Target 100% on this category — 0% was the known failure
   at the last check.
5. **Unknown-drug tests** — a drug not present in any local source
   should either query the FDA API live or clearly refuse; never
   fabricate.
6. **Security tests** — verify one logged-in user cannot access
   another user's chat history or profile data via the API.

---

## 12. Explicit non-goals

- Do not build a diagnosis system. The assistant identifies interactions
  and routes urgent symptoms to professional care — it never tells a
  user what condition they have or what treatment to take beyond what's
  explicitly written in the source data.
- Do not add speculative features (multi-language support, voice,
  mobile app, admin analytics dashboards, etc.) unless explicitly
  requested later. Ship the simplest version that meets every
  requirement above first.
