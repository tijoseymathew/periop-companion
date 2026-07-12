"""Optional Langfuse observability (spec v2-nat §3.5) — hermetic, no network.

Tracing is opt-in by environment, not by config file: the committed configs
carry a non-secret ``_type: periop_langfuse`` tracing block, and the exporter
component decides at build time. All of ``LANGFUSE_PUBLIC_KEY`` /
``LANGFUSE_SECRET_KEY`` / ``LANGFUSE_BASE_URL`` set → real Langfuse exporter;
any missing → one WARNING naming the missing vars and a no-op exporter —
never a crash, never a half-configured exporter that fails at request time.
"""

import logging

import pytest

from periop.nat.observability import (
    REQUIRED_VARS,
    NoOpTelemetryExporter,
    PeriopLangfuseTelemetryExporter,
    langfuse_endpoint_from_env,
    periop_langfuse_telemetry_exporter,
)

ALL_VARS = {
    "LANGFUSE_PUBLIC_KEY": "pk-lf-test",
    "LANGFUSE_SECRET_KEY": "sk-lf-test",
    "LANGFUSE_BASE_URL": "http://localhost:3000",
}


@pytest.fixture
def no_langfuse_env(monkeypatch):
    for var in REQUIRED_VARS:
        monkeypatch.delenv(var, raising=False)


class TestLangfuseEndpointFromEnv:
    def test_all_vars_unset_returns_none_and_warns_once(self, no_langfuse_env, caplog):
        with caplog.at_level(logging.WARNING, logger="periop.nat.observability"):
            assert langfuse_endpoint_from_env() is None
        warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
        assert len(warnings) == 1
        for var in REQUIRED_VARS:
            assert var in warnings[0].getMessage()

    def test_partial_vars_warn_naming_exactly_the_missing(
        self, no_langfuse_env, monkeypatch, caplog
    ):
        monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-lf-test")
        with caplog.at_level(logging.WARNING, logger="periop.nat.observability"):
            assert langfuse_endpoint_from_env() is None
        message = caplog.records[-1].getMessage()
        assert "LANGFUSE_SECRET_KEY" in message
        assert "LANGFUSE_BASE_URL" in message
        assert "LANGFUSE_PUBLIC_KEY" not in message

    def test_all_vars_set_derives_the_otel_endpoint(
        self, no_langfuse_env, monkeypatch, caplog
    ):
        for var, value in ALL_VARS.items():
            monkeypatch.setenv(var, value)
        with caplog.at_level(logging.WARNING, logger="periop.nat.observability"):
            endpoint = langfuse_endpoint_from_env()
        assert endpoint == "http://localhost:3000/api/public/otel/v1/traces"
        assert not caplog.records

    def test_trailing_slash_on_base_url_is_tolerated(self, no_langfuse_env, monkeypatch):
        for var, value in ALL_VARS.items():
            monkeypatch.setenv(var, value)
        monkeypatch.setenv("LANGFUSE_BASE_URL", "http://localhost:3000/")
        assert langfuse_endpoint_from_env() == (
            "http://localhost:3000/api/public/otel/v1/traces"
        )

    @pytest.mark.parametrize("quote", ['"', "'"])
    def test_quoted_base_url_from_env_file_is_dequoted(
        self, no_langfuse_env, monkeypatch, quote
    ):
        """Docker --env-file keeps quotes literally; the endpoint must not."""
        for var, value in ALL_VARS.items():
            monkeypatch.setenv(var, value)
        monkeypatch.setenv("LANGFUSE_BASE_URL", f"{quote}https://cloud.langfuse.com{quote}")
        assert langfuse_endpoint_from_env() == (
            "https://cloud.langfuse.com/api/public/otel/v1/traces"
        )

    def test_quoted_keys_are_dequoted_in_place(self, no_langfuse_env, monkeypatch):
        """The stock exporter reads the keys from the environment, so they must
        be cleaned there too — not just the URL we build."""
        import os

        for var, value in ALL_VARS.items():
            monkeypatch.setenv(var, f'"{value}"')
        langfuse_endpoint_from_env()
        assert os.environ["LANGFUSE_PUBLIC_KEY"] == "pk-lf-test"
        assert os.environ["LANGFUSE_SECRET_KEY"] == "sk-lf-test"


class TestPeriopLangfuseExporterComponent:
    """The registered ``_type: periop_langfuse`` component — the single place
    batch (`nat run`/`nat eval`) and live (API lifespan) runs get tracing."""

    async def test_without_credentials_yields_noop_exporter(self, no_langfuse_env):
        config = PeriopLangfuseTelemetryExporter()
        async with periop_langfuse_telemetry_exporter(config, None) as exporter:
            assert isinstance(exporter, NoOpTelemetryExporter)
            exporter.export(object())  # swallows anything, never raises

    async def test_with_credentials_yields_real_langfuse_exporter(
        self, no_langfuse_env, monkeypatch
    ):
        from nat.plugins.opentelemetry import OTLPSpanAdapterExporter

        for var, value in ALL_VARS.items():
            monkeypatch.setenv(var, value)
        config = PeriopLangfuseTelemetryExporter()
        async with periop_langfuse_telemetry_exporter(config, None) as exporter:
            # constructing the exporter is pure — the HTTP export only happens
            # inside a live Runner run, which this test never performs
            assert isinstance(exporter, OTLPSpanAdapterExporter)

    async def test_workflow_with_tracing_block_runs_without_credentials(
        self, no_langfuse_env, tmp_path
    ):
        """The whole degradation ladder end to end: a config that asks for
        tracing still runs a workflow when the environment can't provide it."""
        from tests.test_nat_workflow import run_workflow, seed_case_with_document

        from periop.store import CaseStore

        config = tmp_path / "api.yml"
        config.write_text(
            f"""\
general:
  telemetry:
    tracing:
      langfuse:
        _type: periop_langfuse
workflow:
  _type: periop_stage_run
  case_dir: {tmp_path / "cases"}
  stub: true
"""
        )
        seed_case_with_document(CaseStore(tmp_path / "cases" / "_out"), "sg-0200")
        result = await run_workflow(config, '{"case_id": "sg-0200", "stage": "preop"}')
        assert "sg-0200" in result
