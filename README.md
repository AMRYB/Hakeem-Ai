# Grounded DDI Assistant

A complete login-gated Drug–Drug Interaction / medication-safety web application built from `BUILD_SPEC.md`.

## What is implemented

- **Frontend:** Next.js 16 + React 19.
- **Backend:** FastAPI mounted under `/api` so the Next.js app and Python API can deploy together on Vercel.
- **Authentication:** email/password, Argon2 password hashing, signed JWT bearer tokens.
- **Encrypted profile:** name, age and optional health notes encrypted with Fernet before database storage.
- **Conversation memory:** last 6 completed Q/A turns per authenticated chat session.
- **DDInter-first DDI lookup:** exact normalized pair lookup happens before semantic retrieval.
- **3+ drug queries:** every pairwise combination is checked against DDInter deterministically.
- **RAG:** EDA CSV + formulary PDF section-aware chunking, dense retrieval, lexical retrieval, Reciprocal Rank Fusion, forced interaction/contraindication sections, cross-encoder reranking.
- **Hard grounding gate:** a two-drug answer is refused if no retrieved evidence contains both named drugs together.
- **Safety gate:** configurable regex patterns run before drug extraction/RAG and bypass normal answer generation when urgent symptoms are detected.
- **FDA fallback:** live openFDA label lookup when local evidence is absent/unknown; pairwise FDA fallback only passes when an interaction section literally mentions the other drug.
- **LLM abstraction:** Ollama generator; set `OLLAMA_MODEL=qwen2.5:latest` or your Llama model name without changing code.
- **Production RAG storage:** pgvector when `DATABASE_URL` is PostgreSQL.
- **Local RAG storage:** Chroma when `DATABASE_URL` is SQLite.
- **Automated tests:** safety routing, intent detection, hard grounding, user/session isolation, plus data-backed DDInter integration tests.

## 1. Put your files in the placeholders

See `data/README.md`.

```text
data/
├── ddinter/
│   └── ddinter_downloads_code_*.csv
├── egypt/
│   └── eda_all_drug_monographs.csv
└── formulary/
    └── *.pdf
```

If you are using the full fixed package generated in this chat, the supplied data is already placed in these folders. The smaller patch package contains only the files that changed.

## 2. Local setup (Qwen 2.5 or Llama with Ollama)

### Prerequisites

- Python 3.12+
- Node.js 20+
- Ollama

Create the environment:

```bash
cp .env.example .env
python -m venv .venv
# Windows PowerShell:
.\.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate
pip install -r requirements.txt
npm install
```

Generate a Fernet key once:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Paste it into `.env` as `PROFILE_ENCRYPTION_KEY=...`, and replace `SECRET_KEY` with a long random secret.

### Ollama

For Qwen:

```bash
ollama pull qwen2.5:latest
```

Then keep:

```env
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:latest
```

For a Llama model, pull the exact model you want and change only `OLLAMA_MODEL`.

The default embedding provider is a PubMedBERT-based sentence-transformer. If you prefer embeddings through Ollama instead, change:

```env
EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=embeddinggemma
```

and run:

```bash
ollama pull embeddinggemma
```

Use the **same embedding model for ingestion and query time**.

### Validate your data and build the index

```bash
python scripts/check_data.py
python scripts/ingest.py --reset
```

This loads DDInter into the SQL database and embeds EDA/formulary chunks into Chroma for local development.

### Run backend + frontend

Terminal 1:

```bash
uvicorn backend.app:app --reload --port 8000
```

Terminal 2:

```bash
npm run dev
```

Open `http://localhost:3000`.

FastAPI docs are at `http://localhost:8000/docs`.


## 2A. Data-quality and retrieval fixes in this build

This revision adds the fixes discovered during local testing:

- **Out-of-scope gate:** unrelated prompts such as `what is banana bread` stop before vector retrieval/LLM generation.
- **EDA CSV preprocessing:** `scripts/ingest.py` automatically creates `data/egypt/eda_all_drug_monographs_cleaned.csv` from `raw_monograph_text`. It reconstructs table-split headings such as `Contra- / Indications` and `Pregnancy and / Lactation` and rebuilds noisy structured columns.
- **Patient-context retrieval:** pregnancy, breastfeeding, renal, hepatic, allergy, age and dosing questions force the corresponding monograph sections rather than only Interaction/Contraindication sections.
- **Topic confidence gate:** a pregnancy question cannot pass merely because an unrelated Warfarin chunk was retrieved; at least one retrieved chunk must address the requested safety topic.
- **Named-drug filter:** single-drug and patient-context questions cannot use semantically similar chunks about a different drug.
- **Brand/synonym normalization:** `data/aliases/drug_aliases.csv` currently includes the tested mappings Panadol -> Acetaminophen, Paracetamol -> Acetaminophen, Aspirin -> Acetylsalicylic acid, and Antinal -> Nifuroxazide. This file is normalization metadata only; it never counts as clinical interaction evidence.
- **Primary-evidence rule for aliases:** if an alias resolves to a drug without a local monograph (for example Acetaminophen in the supplied EDA CSV), single-drug questions go to the FDA fallback instead of using an incidental mention in another monograph.
- **Profile safety context:** the user's name is never sent to the LLM. Deterministically recognized pregnancy/renal/hepatic/allergy factors and pediatric/older-adult age bands may influence relevant retrieval; exact age is only included for explicit age/dose questions.
- **Clean RAG reset:** `--reset` now clears the Chroma/pgvector collection as well as SQL chunk rows, so stale vectors cannot remain after a rebuild.
- **Visible ingestion progress:** embedding now prints `current/total (%)`.

### Required one-time rebuild after applying this patch

Because your old Chroma index was built with the previous section parser, run this once after replacing the files:

```powershell
python scripts\check_data.py
python scripts\ingest.py --reset
```

This resets only DDInter/RAG corpus data; it does not delete user accounts, encrypted profiles, or chat sessions. After this rebuild, future additions can normally use `python scripts\ingest.py` without `--reset`.

Recommended regression prompts after the rebuild:

```text
what is banana bread
what is panadol
can i take warfarin and aspirin?
can i take Panadol and Antinal?
can a pregnant woman take warfarin?
I am taking warfarin and I have unusual bleeding. What should I do?
```

Expected routing: out-of-scope; Panadol normalized to Acetaminophen and uses primary/FDA evidence; Warfarin + Aspirin resolves to the DDInter Acetylsalicylic-acid pair; Panadol + Antinal refuses if no Nifuroxazide pair/evidence exists; pregnancy retrieves Warfarin Pregnancy/Contraindications; unusual bleeding triggers the deterministic safety path.

## 3. Run tests

```bash
pytest
```

The tests that need your real DDInter files automatically skip until the files are present and ingested.

## 4. Vercel deployment

### Important: local Ollama vs Vercel

A Vercel function cannot call `http://localhost:11434` on **your laptop**. `localhost` from the deployed function means the Vercel function itself.

For a deployed app you have three practical options:

1. Run Ollama on a server that exposes an HTTPS endpoint reachable by Vercel, then set `OLLAMA_BASE_URL` to that endpoint.
2. Use Ollama's cloud API / a cloud-hosted model and set `OLLAMA_API_KEY`.
3. Keep the full app local while using a purely local Qwen/Llama model.

The code does not hard-code a model name, so local Qwen and a deployed reachable model use the same adapter.

### Production database

Vercel functions do not provide a persistent writable project filesystem. Use PostgreSQL with pgvector in production (Neon or another pgvector-capable Postgres provider).

Set these Vercel environment variables:

```env
APP_ENV=production
SECRET_KEY=<strong random secret>
PROFILE_ENCRYPTION_KEY=<Fernet key>
DATABASE_URL=postgresql+psycopg://...
RAG_STORE=pgvector
OLLAMA_BASE_URL=https://<your-reachable-ollama-host>
OLLAMA_MODEL=qwen2.5:latest
# only if needed by that Ollama endpoint:
OLLAMA_API_KEY=...
```

If your deployed Ollama endpoint also serves embeddings:

```env
EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=embeddinggemma
```

### Ingest into production Postgres **before** deploying/using the chat

On your own machine, temporarily set `.env` to the production `DATABASE_URL` and production embedding configuration, then run:

```bash
python scripts/ingest.py --reset
```

That pushes the structured DDI table, chunk metadata and pgvector embeddings into your production Postgres. Your raw CSV/PDF files therefore do **not** need to be bundled into the Vercel function.

Then deploy:

```bash
npm i -g vercel
vercel
vercel --prod
```

The included `vercel.json` gives the Python function up to 300 seconds and excludes raw datasets/tests from the function bundle.

## 5. Request flow

```text
User message
   ↓
Deterministic urgent-symptom Safety Gate
   ├── urgent → fixed non-diagnostic emergency response; stop
   ↓
Drug-name extraction from DDInter + monograph vocabulary
   ↓
Deterministic intent classification
   ↓
DDInter exact pair lookup / all pair combinations
   ↓
Forced interaction + contraindication sections
   + dense semantic retrieval
   + lexical/metadata retrieval
   ↓
Reciprocal Rank Fusion
   ↓
Cross-encoder reranking
   ↓
Hard confidence gate
   ├── weak / no two-drug co-occurrence → exact refusal; no LLM call
   ↓
Strict evidence-only prompt → Ollama Qwen/Llama
   ↓
Answer + source cards
```

## 6. Main files

```text
api/index.py                    Vercel FastAPI entry point
backend/app.py                  FastAPI application
backend/routers/auth.py         signup/login
backend/routers/profile.py      encrypted onboarding/profile
backend/routers/chat.py         chat/session endpoints
backend/rag/safety.py           deterministic urgent-symptom router
backend/rag/drug_names.py       known-drug vocabulary + regex extraction
backend/rag/intent.py           deterministic intent classifier
backend/rag/retrieval.py        DDInter-first + hybrid retrieval + forced sections
backend/rag/confidence.py       hard pre-generation grounding gate
backend/rag/fda.py              openFDA fallback
backend/rag/llm.py              swappable Ollama generation adapter
backend/rag/ingestion.py        CSV/PDF section-aware ingestion
backend/rag/vector_store.py     local Chroma / production pgvector
config/safety_patterns.json     editable urgent symptom vocabulary
scripts/ingest.py               build the corpus/index
tests/                          automated safety/grounding/security tests
app/                            Next.js frontend
```

## 7. Safety behavior to verify first

This must route to the safety path and **must not run DDI RAG**:

> I am taking warfarin and I have unusual bleeding. What should I do?

A normal two-drug question should first try the exact DDInter pair. If the pair is absent and no formulary/FDA interaction evidence contains both named drugs, the system returns the refusal template rather than inferring an interaction.

## 8. Known production considerations

- The included in-memory rate limiter is suitable as a basic guard but is per-function-instance on serverless infrastructure. For a higher-stakes public deployment, replace it with a shared Redis/Upstash-backed limiter.
- Downloading large local sentence-transformer/reranker models during a Vercel cold start is undesirable. For production, a reachable embedding/reranking service or prepackaged model is more reliable. The code falls back to lexical reranking if the cross-encoder cannot initialize.
- This project is a medication-safety decision-support prototype, **not a diagnosis system**.
