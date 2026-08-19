# Retrieval Mechanism V3

This patch fixes the retrieval mechanism generically. It does not contain medication-specific branches.

## Core policy

1. Safety gate first.
2. Resolve drug names/aliases.
3. Use conversation history only to resolve missing drug references; old assistant answers are never sent back to the LLM.
4. Build patient context from the current question and, only for first-person suitability questions, the saved profile.
5. DDI questions use exact DDInter pair lookup first.
6. Single-drug/patient-context questions are ownership constrained: only chunks whose `generic_name` belongs to the requested drug are eligible.
7. Explicit context in the current question is a hard retrieval constraint.
8. Saved profile context is matched against the requested drug's own safety sections. Exact/configured concept matches are force-included before reranking.
9. If deterministic context matches exist, unrelated sections are removed before generation.
10. If local evidence does not address the context, try FDA; if FDA also does not address it, refuse.
11. Reranker thresholds cannot discard deterministic exact owner/context matches.
12. Current medications found in profile notes are checked structurally against DDInter.

## Configurable clinical contexts

`config/clinical_contexts.json` contains aliases and section hints for common patient contexts such as pregnancy, breastfeeding, asthma, renal/hepatic impairment, allergies, diabetes, and age groups. New contexts can be added to the JSON without changing retrieval code.

Unknown/unregistered conditions still work when they are explicitly named: the mechanism extracts generic context terms (for example `psoriasis`) and forces exact matches from the requested drug's own monograph.

## Replace/add

- `backend/rag/service.py`
- `backend/rag/retrieval.py`
- `backend/rag/confidence.py`
- `backend/rag/prompts.py`
- `backend/rag/topics.py`
- `backend/rag/patient_context.py` (new)
- `config/clinical_contexts.json` (new)

No re-ingestion is required because this patch changes query-time retrieval/routing only.
