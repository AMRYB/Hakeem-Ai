import glob
import pytest
from sqlalchemy import func, inspect, select

from backend.config import get_settings
from backend.db import SessionLocal, engine
from backend.models import DdiPair
from backend.rag.retrieval import ddi_pair_lookup

settings = get_settings()


def _ingested_ddinter_available() -> bool:
    if not glob.glob(settings.ddinter_glob):
        return False
    try:
        if not inspect(engine).has_table("ddi_pairs"):
            return False
        with SessionLocal() as db:
            return bool(db.scalar(select(func.count()).select_from(DdiPair)))
    except Exception:
        return False


@pytest.mark.skipif(not _ingested_ddinter_available(), reason="DDInter data files exist but local DB has not been ingested yet")
def test_ingested_ddinter_has_rows():
    with SessionLocal() as db:
        count = db.scalar(select(func.count()).select_from(DdiPair))
        assert count and count > 0


@pytest.mark.skipif(not _ingested_ddinter_available(), reason="DDInter data files exist but local DB has not been ingested yet")
def test_real_major_pair_is_retrievable():
    with SessionLocal() as db:
        row = db.scalar(select(DdiPair).where(func.lower(DdiPair.level) == "major").limit(1))
        assert row is not None
        hit = ddi_pair_lookup(db, row.drug_a, row.drug_b)
        assert hit is not None
        assert hit.metadata["level"].casefold() == "major"
