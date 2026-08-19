from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RetrievalTopic:
    name: str
    # Sections worth fetching as candidates from the requested drug's monograph.
    section_keywords: tuple[str, ...]
    # Topic-specific words that make a generic safety section relevant.
    text_keywords: tuple[str, ...]
    # Section names that are intrinsically about the topic and therefore do not
    # require the text to repeat the topic word.
    intrinsic_sections: tuple[str, ...] = ()


TOPICS = (
    RetrievalTopic(
        "pregnancy",
        ("pregnancy", "lactation", "contraindication", "warning"),
        ("pregnan", "trimester", "fetal", "foetal", "embry", "teratogen"),
        ("pregnancy", "lactation"),
    ),
    RetrievalTopic(
        "breastfeeding",
        ("pregnancy", "lactation", "contraindication", "warning"),
        ("breastfeed", "breast milk", "lactation", "nursing infant"),
        ("pregnancy", "lactation"),
    ),
    RetrievalTopic(
        "renal",
        ("dosage adjustment", "contraindication", "warning", "monitoring"),
        ("kidney", "renal", "creatinine", "dialysis", "egfr"),
        (),
    ),
    RetrievalTopic(
        "hepatic",
        ("dosage adjustment", "contraindication", "warning", "monitoring"),
        ("liver", "hepatic", "lft", "transaminase", "cirrhos"),
        (),
    ),
    RetrievalTopic(
        "allergy",
        ("contraindication", "warning", "adverse"),
        ("allerg", "hypersensitiv", "anaphyl"),
        (),
    ),
    RetrievalTopic(
        "age",
        ("dosage regimen", "dosage adjustment", "warning"),
        ("age", "years old", "child", "pediatric", "paediatric", "elderly", "older adult"),
        (),
    ),
    RetrievalTopic(
        "dose",
        ("dosage regimen", "dosage adjustment", "administration"),
        ("dose", "dosage", "dosing", "how much", "how often"),
        ("dosage regimen", "dosage adjustment", "administration"),
    ),
    RetrievalTopic(
        "adverse_reactions",
        ("adverse", "warning"),
        ("side effect", "adverse", "reaction"),
        ("adverse",),
    ),
    RetrievalTopic(
        "contraindications",
        ("contraindication", "warning"),
        ("contraindicat", "should not take", "avoid"),
        ("contraindication",),
    ),
    RetrievalTopic(
        "monitoring",
        ("monitoring", "warning"),
        ("monitor", "test", "follow-up", "follow up", "check"),
        ("monitoring",),
    ),
)


def detect_topics(question: str, intent: str | None = None) -> list[RetrievalTopic]:
    q = question.casefold()
    found = [topic for topic in TOPICS if any(keyword in q for keyword in topic.text_keywords)]

    # Do not invent a generic pseudo-topic for arbitrary profile conditions such as
    # asthma, diabetes, epilepsy, ulcer disease, etc.  When a patient-context query
    # has no predefined topic, retrieval should search the requested drug's own
    # Contraindications / Warnings / Dose-adjustment / Monitoring sections and let
    # lexical + reranker matching use the actual user-provided condition words.
    # A fake topic containing words like "condition" or "disease" filtered out
    # useful evidence such as "Asthma" because the chunk did not literally say
    # "condition".
    return found


def chunk_matches_topic(section: str, text: str, topic: RetrievalTopic) -> bool:
    """Topic relevance without treating every generic Warning/Contraindication as relevant.

    Example: a Ketoconazole contraindications paragraph that merely mentions
    Felodipine is not pregnancy evidence for Felodipine. A Pregnancy and Lactation
    section is intrinsically pregnancy-related; a generic Contraindications section
    must contain pregnancy-specific language to count.
    """
    section_cf = (section or "").casefold()
    text_cf = (text or "").casefold()
    if any(keyword in section_cf for keyword in topic.intrinsic_sections):
        return True
    return any(keyword in text_cf for keyword in topic.text_keywords)
