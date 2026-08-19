from __future__ import annotations

import re
from dataclasses import dataclass

import httpx

from backend.config import get_settings
from backend.rag.types import RetrievedChunk

settings = get_settings()


@dataclass
class FDAResult:
    drug_name: str
    chunks: list[RetrievedChunk]


class FDAClient:
    def __init__(self):
        self.base = settings.fda_api_base.rstrip("/")

    def _params(self, search: str, limit: int = 1) -> dict[str, str | int]:
        params: dict[str, str | int] = {"search": search, "limit": limit}
        if settings.fda_api_key:
            params["api_key"] = settings.fda_api_key
        return params

    def fetch_label(self, drug_name: str) -> FDAResult | None:
        searches = [
            f'openfda.generic_name:"{drug_name}"',
            f'openfda.brand_name:"{drug_name}"',
        ]
        data = None
        used_search = None
        with httpx.Client(timeout=settings.fda_timeout_seconds) as client:
            for search in searches:
                response = client.get(f"{self.base}/drug/label.json", params=self._params(search))
                if response.status_code == 404:
                    continue
                response.raise_for_status()
                payload = response.json()
                if payload.get("results"):
                    data = payload["results"][0]
                    used_search = search
                    break
        if not data:
            return None

        fields = {
            "Drug Interactions": "drug_interactions",
            "Contraindications": "contraindications",
            "Warnings": "warnings",
            "Warnings and Precautions": "warnings_and_cautions",
            "Adverse Reactions": "adverse_reactions",
            "Pregnancy": "pregnancy",
            "Dosage and Administration": "dosage_and_administration",
        }
        chunks: list[RetrievedChunk] = []
        for section, field in fields.items():
            value = data.get(field)
            if not value:
                continue
            text_value = "\n".join(value) if isinstance(value, list) else str(value)
            chunks.append(
                RetrievedChunk(
                    id=f"fda:{drug_name.casefold()}:{field}",
                    text=text_value,
                    source_type="openfda_label",
                    source_title=f"openFDA Drug Label — {drug_name}",
                    source_locator=f"FDA label query: {used_search}",
                    section=section,
                    generic_name=drug_name,
                    metadata={"drug_a": drug_name, "fda_field": field},
                    reranker_score=1.0,
                )
            )
        return FDAResult(drug_name=drug_name, chunks=chunks)

    def fetch_reported_events(self, drug_name: str, limit: int = 10) -> list[str]:
        search = f'patient.drug.openfda.generic_name:"{drug_name}"'
        with httpx.Client(timeout=settings.fda_timeout_seconds) as client:
            response = client.get(f"{self.base}/drug/event.json", params=self._params(search, limit=limit))
            if response.status_code == 404:
                return []
            response.raise_for_status()
            events: list[str] = []
            for result in response.json().get("results", []):
                for reaction in result.get("patient", {}).get("reaction", []) or []:
                    term = reaction.get("reactionmeddrapt")
                    if term:
                        events.append(term)
            return list(dict.fromkeys(events))[:20]


def label_mentions(label_chunks: list[RetrievedChunk], other_drug: str) -> bool:
    pattern = re.compile(rf"(?<![\w-]){re.escape(other_drug)}(?![\w-])", re.IGNORECASE)
    return any(pattern.search(chunk.text) for chunk in label_chunks if "interaction" in chunk.section.casefold())
