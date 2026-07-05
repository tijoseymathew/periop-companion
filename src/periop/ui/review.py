"""Minimal HTML review UI (spec §2 MVP, §4.4).

Renders a Case to a single self-contained HTML page: every generated
artifact as a list of claims, each claim expandable to the exact cited
span — document chunk text (with section) or audio segment with speaker
and (t0, t1) so the reviewer knows which clip to play. Provenance refs
also link into a source-registry section at the bottom of the page.

Unsupported/conflicting claims are visually flagged, and unresolvable
citations are surfaced, never hidden (spec §4.3).
"""

from __future__ import annotations

import html
import re
from pathlib import Path

from periop.schemas import ArtifactRecord, AudioSegment, Case, Chunk, Claim

_CSS = """
body { font-family: system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; }
h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 2rem; }
.claim { border-left: 4px solid #999; padding: .4rem .8rem; margin: .5rem 0; }
.claim.supported { border-color: #2e7d32; }
.claim.unsupported { border-color: #e65100; background: #fff3e0; }
.claim.conflicting { border-color: #c62828; background: #ffebee; }
.claim.unverified { border-color: #999; }
.status { font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; color: #555; }
.cite { margin: .3rem 0 .3rem 1rem; font-size: .9rem; }
.cite blockquote { margin: .2rem 0 .2rem 1rem; color: #333; border-left: 2px solid #ccc; padding-left: .5rem; }
.meta { color: #666; font-size: .8rem; }
.unresolved { color: #c62828; font-weight: bold; }
.source { margin: .5rem 0; padding: .3rem .6rem; border: 1px solid #ddd; }
.source:target { outline: 3px solid #1565c0; }
code { background: #f4f4f4; padding: 0 .2rem; }
"""


def source_anchor_id(ref: str) -> str:
    """Stable HTML element id for a provenance ref (``source_id#anchor``)."""
    return "src-" + re.sub(r"[^A-Za-z0-9]+", "-", ref)


def _render_span(anchor: Chunk | AudioSegment) -> str:
    if isinstance(anchor, AudioSegment):
        meta = f'<span class="meta">{html.escape(anchor.speaker)}, {anchor.t0:.1f}–{anchor.t1:.1f}s</span>'
    else:
        section = f" [{html.escape(anchor.section)}]" if anchor.section else ""
        meta = f'<span class="meta">document{section}</span>'
    return f"{meta}<blockquote>{html.escape(anchor.text)}</blockquote>"


def _render_citation(case: Case, ref) -> str:
    ref_str = str(ref)
    link = f'<a href="#{source_anchor_id(ref_str)}"><code>{html.escape(ref_str)}</code></a>'
    try:
        anchor = case.resolve(ref)
    except (KeyError, ValueError):
        return f'<div class="cite">{link} <span class="unresolved">UNRESOLVED</span></div>'
    return f'<div class="cite">{link} {_render_span(anchor)}</div>'


def _render_claim(case: Case, claim: Claim) -> str:
    citations = "".join(_render_citation(case, ref) for ref in claim.provenance)
    if claim.provenance:
        body = (
            f"<details><summary>{len(claim.provenance)} citation(s)</summary>"
            f"{citations}</details>"
        )
    else:
        body = '<div class="cite meta">no citations</div>'
    return (
        f'<div class="claim {claim.status}">'
        f'<span class="status">{claim.status}</span> '
        f"{html.escape(claim.text)}{body}</div>"
    )


def _render_artifact(case: Case, artifact: ArtifactRecord) -> str:
    claims = "".join(_render_claim(case, c) for c in artifact.claims)
    return (
        f"<h2>{html.escape(artifact.artifact_id)} "
        f'<span class="meta">({len(artifact.claims)} claims)</span></h2>{claims}'
    )


def _render_sources(case: Case) -> str:
    entries = []
    for source in case.sources:
        anchors = source.chunks or source.segments
        for anchor in anchors:
            anchor_id = anchor.chunk_id if isinstance(anchor, Chunk) else anchor.seg_id
            ref = f"{source.source_id}#{anchor_id}"
            entries.append(
                f'<div class="source" id="{source_anchor_id(ref)}">'
                f"<code>{html.escape(ref)}</code> {_render_span(anchor)}</div>"
            )
    return "<h2>Source registry</h2>" + "".join(entries)


def render_review_html(case: Case) -> str:
    artifacts = "".join(_render_artifact(case, a) for a in case.artifacts)
    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<title>PeriOp review — {html.escape(case.case_id)}</title>"
        f"<style>{_CSS}</style></head><body>"
        f"<h1>PeriOp Companion review — {html.escape(case.case_id)}</h1>"
        "<p class='meta'>Documentation aid — human review required. "
        "Click a claim's citations to see the exact cited span.</p>"
        f"{artifacts}{_render_sources(case)}</body></html>"
    )


def write_review(case: Case, out_dir: Path | str) -> Path:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{case.case_id}.html"
    path.write_text(render_review_html(case))
    return path
