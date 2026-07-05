"""Audio file serving with HTTP Range support (spec ui.md §4).

``source_id`` → filename is the existing convention: strip the ``audio:``
prefix, append ``.wav``. The id must name an audio source registered in the
case, which also forecloses path traversal; a resolved-path containment check
backs that up. Wavs are gitignored, so a missing file is an expected state —
the 404 body points at the regeneration script.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from periop.api.routers.cases import load_case
from periop.schemas import SourceType

router = APIRouter()


@router.get("/cases/{case_id}/audio/{source_id}")
def get_audio(request: Request, case_id: str, source_id: str) -> FileResponse:
    case = load_case(request, case_id)
    source = case.get_source(source_id)
    if source is None or source.type is not SourceType.AUDIO:
        raise HTTPException(
            status_code=404, detail=f"case {case_id} has no audio source {source_id!r}"
        )

    audio_dir = (request.app.state.case_dir / case_id / "audio").resolve()
    path = (audio_dir / f"{source_id.removeprefix('audio:')}.wav").resolve()
    if not path.is_relative_to(audio_dir):
        raise HTTPException(status_code=404, detail=f"invalid source id {source_id!r}")
    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail=(
                f"no rendered wav for {source_id!r} (wavs are gitignored); "
                "regenerate with: uv run python scripts/render_audio.py"
            ),
        )
    # FileResponse handles Range requests (206) so <audio> seeking works
    return FileResponse(path, media_type="audio/wav")
