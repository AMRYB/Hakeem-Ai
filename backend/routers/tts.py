from __future__ import annotations

import os
import re

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from backend.dependencies import get_current_user
from backend.models import User

router = APIRouter(prefix="/api/tts", tags=["tts"])


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=6000)


def _clean_for_speech(text: str) -> str:
    value = re.sub(r"```.*?```", " ", text, flags=re.S)
    value = re.sub(r"`([^`]+)`", r"\1", value)
    value = re.sub(r"\[(\d+)\]", " ", value)
    value = re.sub(r"[*_#>-]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


@router.post("")
def create_speech(payload: TtsRequest, user: User = Depends(get_current_user)):
    # Read credentials at request time so each fresh Vercel deployment uses its current environment.
    api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="ElevenLabs is not configured yet")

    voice_id = os.getenv("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb").strip()
    model_id = os.getenv("ELEVENLABS_MODEL_ID", "eleven_v3").strip() or "eleven_v3"
    text = _clean_for_speech(payload.text)
    if not text:
        raise HTTPException(status_code=400, detail="There is no readable text")

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    try:
        with httpx.Client(timeout=90.0) as client:
            response = client.post(
                url,
                params={"output_format": "mp3_44100_128"},
                headers={
                    "xi-api-key": api_key,
                    "Content-Type": "application/json",
                    "Accept": "audio/mpeg",
                },
                json={
                    "text": text,
                    "model_id": model_id,
                    "language_code": "en",
                },
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"ElevenLabs request failed: {exc.__class__.__name__}") from exc

    if response.status_code >= 400:
        detail = "ElevenLabs could not generate audio"
        try:
            body = response.json()
            detail = body.get("detail", {}).get("message") or body.get("detail") or detail
        except Exception:
            pass
        raise HTTPException(status_code=502, detail=str(detail))

    return Response(
        content=response.content,
        media_type="audio/mpeg",
        headers={"Cache-Control": "private, no-store"},
    )
