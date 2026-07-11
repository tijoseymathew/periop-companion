"""The ADK-native composition (spec §3.1): structure, retries, model paths.

The rest of the suite exercises the pipeline through the stage seams with
structured-protocol stubs; these tests pin what makes the implementation an
ADK one — LlmAgent steps inside stage SequentialAgents, LoopAgent retry with
validation-error feedback, the ParallelAgent post-op writers — and cover the
text protocol the live NIM tiers actually speak.
"""

import pytest
from google.adk.agents import LlmAgent, LoopAgent, ParallelAgent, SequentialAgent

from periop.adk.runtime import run_agent
from periop.adk.stages import build_case_pipeline, gap_analyst_step
from periop.adk.steps import StructuredValidator
from periop.agents.gap_analyst import SYSTEM as GAP_SYSTEM
from periop.schemas import Case, Chunk, OpenQuestion, Source, SourceType

VALID_REPLY = (
    '{"questions": [{"question": "Still on aspirin?", "reason": "conflicting",'
    ' "provenance": ["doc:med-list#c001"]}]}'
)


def _doc_case() -> Case:
    case = Case(case_id="sg-t001")
    case.add_source(
        Source(
            source_id="doc:med-list",
            type=SourceType.DOCUMENT,
            chunks=[Chunk(chunk_id="c001", section="Medications",
                          text="Aspirin 100mg daily.")],
        )
    )
    return case


class TextChat:
    """Speaks only the live protocol: plain-text completions."""

    def __init__(self, replies: list[str]):
        self.replies = list(replies)
        self.prompts: list[tuple[str | None, str]] = []

    def complete(self, user: str, system: str | None = None, **kwargs) -> str:
        self.prompts.append((system, user))
        return self.replies.pop(0)


class TestPipelineStructure:
    def test_stages_are_sequential_compositions(self):
        pipeline = build_case_pipeline("data/cases/sg-0001", chat=object())
        assert [a.name for a in pipeline.sub_agents] == [
            "preop_stage", "intraop_stage", "postop_stage",
        ]
        assert all(isinstance(a, SequentialAgent) for a in pipeline.sub_agents)

    def test_llm_steps_are_loopagents_over_llmagent_writers(self):
        pipeline = build_case_pipeline("data/cases/sg-0001", chat=object())
        preop = pipeline.sub_agents[0]
        names = [a.name for a in preop.sub_agents]
        assert names == [
            "record_ingestor", "gap_analyst", "interview_transcriber",
            "preop_note", "preop_verifier", "preop_artifacts",
        ]
        gap = preop.sub_agents[1]
        assert isinstance(gap, LoopAgent)
        writer, validator = gap.sub_agents
        assert isinstance(writer, LlmAgent) and writer.name == "gap_analyst_writer"
        assert isinstance(validator, StructuredValidator)

    def test_intraop_extraction_is_two_tier(self):
        fast, reasoning = object(), object()
        pipeline = build_case_pipeline("x", chat=reasoning, fast_chat=fast)
        intraop = pipeline.sub_agents[1]
        names = [a.name for a in intraop.sub_agents]
        assert "event_first_pass" in names and "event_verify" in names
        first = next(a for a in intraop.sub_agents if a.name == "event_first_pass")
        verify = next(a for a in intraop.sub_agents if a.name == "event_verify")
        assert first.sub_agents[0].model.chat is fast
        assert verify.sub_agents[0].model.chat is reasoning

    def test_postop_writers_run_under_a_parallel_agent(self):
        pipeline = build_case_pipeline("x", chat=object())
        postop = pipeline.sub_agents[2]
        writers = next(a for a in postop.sub_agents if a.name == "postop_writers")
        assert isinstance(writers, ParallelAgent)
        assert {a.name for a in writers.sub_agents} == {"handoff", "postop_eval"}
        # ledger commit is a separate, ordered step behind the parallel block
        names = [a.name for a in postop.sub_agents]
        assert names.index("postop_writers") < names.index("postop_ledger")


class TestTextProtocol:
    """The live path: prompt embeds the JSON Schema, validator parses text."""

    def test_valid_reply_first_time(self):
        chat = TextChat([VALID_REPLY])
        case, _ = run_agent(gap_analyst_step(chat, skip_when_present=False), _doc_case())
        assert [q.question for q in case.open_questions] == ["Still on aspirin?"]
        system, user = chat.prompts[0]
        assert system == GAP_SYSTEM
        assert "Respond with a single JSON object" in user
        assert "[doc:med-list#c001]" in user

    def test_invalid_reply_retries_with_validation_feedback(self):
        chat = TextChat(["not json at all", VALID_REPLY])
        case, _ = run_agent(gap_analyst_step(chat, skip_when_present=False), _doc_case())
        assert len(chat.prompts) == 2
        assert [q.question for q in case.open_questions] == ["Still on aspirin?"]
        retry_user = chat.prompts[1][1]
        assert "Your previous reply was rejected" in retry_user
        assert "not json at all" in retry_user

    def test_exhausted_attempts_raise(self):
        chat = TextChat(["nope", "still nope", "never json"])
        with pytest.raises(ValueError, match="failed to produce valid GapQuestions"):
            run_agent(gap_analyst_step(chat, skip_when_present=False), _doc_case())
        assert len(chat.prompts) == 3

    def test_reasoning_wrapped_json_is_parsed(self):
        # Nemotron replies often carry prose around the JSON; the validator
        # scans candidates rather than trusting reply.startswith("{")
        chat = TextChat([f"Here are the questions:\n```json\n{VALID_REPLY}\n```"])
        case, _ = run_agent(gap_analyst_step(chat, skip_when_present=False), _doc_case())
        assert len(case.open_questions) == 1


class TestSkipConditions:
    def test_gap_analysis_skipped_when_questions_exist(self):
        case = _doc_case()
        case.open_questions = [
            OpenQuestion(question="Existing?", reason="missing",
                         provenance=["doc:med-list#c001"])
        ]

        class ExplodingChat:
            def complete(self, user, system=None, **kwargs):
                raise AssertionError("gap analyst must not run")

        result, _ = run_agent(gap_analyst_step(ExplodingChat()), case)
        assert [q.question for q in result.open_questions] == ["Existing?"]
