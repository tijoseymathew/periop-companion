"""Optional Langfuse tracing, opt-in by environment (spec v2-nat §3.5).

One registered NAT component, ``_type: periop_langfuse``, referenced by every
committed config (batch ``nat run``/``nat eval`` and the API server alike) so
there is exactly one credential check and one exporter destination. The YAML
never carries a secret or an endpoint — everything comes from
``LANGFUSE_PUBLIC_KEY`` / ``LANGFUSE_SECRET_KEY`` / ``LANGFUSE_BASE_URL``.

Missing credentials degrade to "no observability", exactly like every other
optional integration in this project (v1 §10's diarization fallback, v2
§6.7's "errors say what to do"): one WARNING naming the missing variable(s),
a no-op exporter, never a crash, never a half-configured exporter that fails
at request time.

The spec drafted this as an ``apply_optional_telemetry(config)`` helper
called after ``load_config``; a registered component is used instead because
the batch path is NAT's own CLI (``nat eval``), which offers no hook between
config load and workflow build — a component reaches every entry point
through the same ``nat.components`` discovery that already loads
``periop.nat.register``.
"""

from __future__ import annotations

import logging
import os

from nat.builder.builder import Builder
from nat.cli.register_workflow import register_telemetry_exporter
from nat.data_models.telemetry_exporter import TelemetryExporterBaseConfig
from nat.observability.exporter.base_exporter import BaseExporter

logger = logging.getLogger(__name__)

REQUIRED_VARS = ("LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL")


def _dequote(value: str) -> str:
    """Strip surrounding whitespace and one matching pair of quotes.

    Docker ``--env-file`` (and some secret stores) keep quote characters
    literally — unlike a shell or python-dotenv — so a ``.env`` line like
    ``LANGFUSE_BASE_URL="https://cloud.langfuse.com"`` otherwise yields the
    invalid endpoint ``"https://cloud.langfuse.com"/api/public/otel/v1/traces``.
    """
    v = value.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
        v = v[1:-1].strip()
    return v


def _normalize_langfuse_env() -> None:
    """Dequote the LANGFUSE_* vars in place so both the endpoint we build and
    the keys the stock exporter reads from the environment are clean."""
    for var in REQUIRED_VARS:
        raw = os.environ.get(var)
        if raw is not None:
            os.environ[var] = _dequote(raw)


def langfuse_endpoint_from_env() -> str | None:
    """The Langfuse OTel traces endpoint, or None (with one warning) if the
    environment doesn't provide complete credentials."""
    _normalize_langfuse_env()
    missing = [var for var in REQUIRED_VARS if not os.environ.get(var)]
    if missing:
        logger.warning(
            "Langfuse tracing disabled — missing env var(s): %s. "
            "Set all three LANGFUSE_* variables to trace NAT runs; "
            "the app runs normally without them.",
            ", ".join(missing),
        )
        return None
    base_url = os.environ["LANGFUSE_BASE_URL"].rstrip("/")
    return f"{base_url}/api/public/otel/v1/traces"


class NoOpTelemetryExporter(BaseExporter):
    """Subscribes to nothing-in-particular and drops every event."""

    def export(self, event) -> None:
        pass


class PeriopLangfuseTelemetryExporter(TelemetryExporterBaseConfig, name="periop_langfuse"):
    """Langfuse tracing iff the environment provides credentials.

    Deliberately field-free: endpoint and keys are deployment secrets read
    from the environment, never from YAML.
    """


@register_telemetry_exporter(config_type=PeriopLangfuseTelemetryExporter)
async def periop_langfuse_telemetry_exporter(
    config: PeriopLangfuseTelemetryExporter, builder: Builder
):
    endpoint = langfuse_endpoint_from_env()
    if endpoint is None:
        yield NoOpTelemetryExporter()
        return

    # delegate to the stock exporter (nvidia-nat[opentelemetry]); it reads
    # the Basic-Auth keys from the same environment variables
    from nat.plugins.opentelemetry.register import (
        LangfuseTelemetryExporter,
        langfuse_telemetry_exporter,
    )

    stock = LangfuseTelemetryExporter(endpoint=endpoint)
    async with langfuse_telemetry_exporter(stock, builder) as exporter:
        yield exporter
