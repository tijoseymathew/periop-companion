"""Core data model: the Case object and its provenance substrate.

Every generated note is stored as a set of claims; each claim cites one or
more anchors (``source_id#anchor``) into an append-only source registry.
Conflicts are first-class claim states, never silently resolved.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Any

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    PlainSerializer,
    model_validator,
)


class SourceType(StrEnum):
    DOCUMENT = "document"
    AUDIO = "audio"


class ClaimStatus(StrEnum):
    UNVERIFIED = "unverified"
    SUPPORTED = "supported"
    UNSUPPORTED = "unsupported"
    CONFLICTING = "conflicting"


class EventCategory(StrEnum):
    AGENT = "agent"
    DOSE = "dose"
    AIRWAY = "airway"
    LINE = "line"
    FLUID = "fluid"
    EVENT = "event"


class ProvenanceRef(BaseModel):
    """A citation into a source: ``source_id#anchor``.

    The anchor is a chunk id for documents or a segment id for audio. Source
    ids contain colons (``doc:op-plan``), so only the final ``#`` delimits
    the anchor.
    """

    model_config = ConfigDict(frozen=True)

    source_id: str
    anchor: str

    @classmethod
    def parse(cls, ref: str) -> ProvenanceRef:
        source_id, sep, anchor = ref.rpartition("#")
        if not sep or not source_id or not anchor:
            raise ValueError(f"provenance ref must look like 'source_id#anchor', got {ref!r}")
        return cls(source_id=source_id, anchor=anchor)

    def __str__(self) -> str:
        return f"{self.source_id}#{self.anchor}"


def _coerce_ref(value: Any) -> Any:
    if isinstance(value, str):
        return ProvenanceRef.parse(value)
    return value


ProvenanceRefField = Annotated[
    ProvenanceRef,
    BeforeValidator(_coerce_ref),
    PlainSerializer(str, return_type=str, when_used="json"),
]


class Chunk(BaseModel):
    """A citable slice of a document with a stable id."""

    chunk_id: str
    text: str
    section: str | None = None


class AudioSegment(BaseModel):
    """A diarized, timestamped slice of an audio source."""

    seg_id: str
    t0: float
    t1: float
    speaker: str
    text: str

    @model_validator(mode="after")
    def _times_ordered(self) -> AudioSegment:
        if self.t1 < self.t0:
            raise ValueError(f"segment {self.seg_id}: t1 ({self.t1}) precedes t0 ({self.t0})")
        return self


class Source(BaseModel):
    """One entry in the case's append-only source registry."""

    source_id: str
    type: SourceType
    chunks: list[Chunk] = Field(default_factory=list)
    segments: list[AudioSegment] = Field(default_factory=list)

    @model_validator(mode="after")
    def _content_matches_type(self) -> Source:
        if self.type is SourceType.DOCUMENT and self.segments:
            raise ValueError(f"document source {self.source_id} cannot hold audio segments")
        if self.type is SourceType.AUDIO and self.chunks:
            raise ValueError(f"audio source {self.source_id} cannot hold document chunks")
        return self

    def get_anchor(self, anchor: str) -> Chunk | AudioSegment | None:
        if self.type is SourceType.DOCUMENT:
            return next((c for c in self.chunks if c.chunk_id == anchor), None)
        return next((s for s in self.segments if s.seg_id == anchor), None)


class Claim(BaseModel):
    """An atomic, citable statement extracted from a generated note."""

    claim_id: str
    text: str
    provenance: list[ProvenanceRefField] = Field(default_factory=list)
    status: ClaimStatus = ClaimStatus.UNVERIFIED


class Event(BaseModel):
    """A structured intra-op event extracted from voice notes."""

    t: str
    category: EventCategory
    value: str
    units: str | None = None
    provenance: list[ProvenanceRefField] = Field(default_factory=list)


class ArtifactRecord(BaseModel):
    """A generated output (note, record, handoff) stored as claims."""

    artifact_id: str
    claims: list[Claim] = Field(default_factory=list)


class Case(BaseModel):
    """Longitudinal state for one patient journey across all three stages."""

    case_id: str
    patient_profile_ref: str | None = None
    sources: list[Source] = Field(default_factory=list)
    artifacts: list[ArtifactRecord] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    intraop_events: list[Event] = Field(default_factory=list)
    anticipated_issues: list[str] = Field(default_factory=list)

    def add_source(self, source: Source) -> None:
        if self.get_source(source.source_id) is not None:
            raise ValueError(f"source {source.source_id!r} already registered (registry is append-only)")
        self.sources.append(source)

    def get_source(self, source_id: str) -> Source | None:
        return next((s for s in self.sources if s.source_id == source_id), None)

    def resolve(self, ref: ProvenanceRef | str) -> Chunk | AudioSegment:
        if isinstance(ref, str):
            ref = ProvenanceRef.parse(ref)
        source = self.get_source(ref.source_id)
        if source is None:
            raise KeyError(f"unknown source in provenance ref {ref}")
        anchor = source.get_anchor(ref.anchor)
        if anchor is None:
            raise KeyError(f"unknown anchor in provenance ref {ref}")
        return anchor

    def add_artifact(self, artifact: ArtifactRecord) -> None:
        for claim in artifact.claims:
            for ref in claim.provenance:
                try:
                    self.resolve(ref)
                except KeyError:
                    raise ValueError(
                        f"claim {claim.claim_id!r} in artifact {artifact.artifact_id!r} "
                        f"cites unresolvable provenance {ref}"
                    ) from None
        self.artifacts.append(artifact)

    def get_artifact(self, artifact_id: str) -> ArtifactRecord | None:
        return next((a for a in self.artifacts if a.artifact_id == artifact_id), None)

    def get_claim(self, ref: str) -> Claim | None:
        """Resolve a global claim ref ``artifact_id#claim_id`` to its Claim.

        Used by the HandoffComposer, which composes over existing claims
        rather than raw sources.
        """
        artifact_id, sep, claim_id = ref.rpartition("#")
        if not sep:
            return None
        artifact = self.get_artifact(artifact_id)
        if artifact is None:
            return None
        return next((c for c in artifact.claims if c.claim_id == claim_id), None)
