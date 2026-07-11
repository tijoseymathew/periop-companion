"""ADK-native orchestration for the peri-op pipeline.

This package is the real implementation of spec §3.1's middle layer: stages
are ``SequentialAgent`` compositions of ``LlmAgent`` steps, generation retries
are ``LoopAgent`` generate/validate cycles, the independent post-op writers
run under a ``ParallelAgent``, and the Case travels in ADK session state.
``periop.agents`` keeps the prompts/schemas and thin facades for standalone
callers; everything they do executes through the agents built here.
"""

from periop.adk.model import ChatModel
from periop.adk.runtime import CASE_KEY, run_agent, run_agent_async, sync_case
from periop.adk.stages import (
    build_case_pipeline,
    build_intraop_stage,
    build_postop_stage,
    build_preop_stage,
)

__all__ = [
    "CASE_KEY",
    "ChatModel",
    "build_case_pipeline",
    "build_intraop_stage",
    "build_postop_stage",
    "build_preop_stage",
    "run_agent",
    "run_agent_async",
    "sync_case",
]
