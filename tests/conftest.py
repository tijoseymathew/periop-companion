"""Suite-wide hermeticity guards."""

import pytest


@pytest.fixture(autouse=True)
def _no_langfuse_export(monkeypatch):
    """Tests never export traces, even on a machine whose .env has real
    Langfuse credentials: empty strings survive ``load_dotenv`` (which never
    overrides an existing var) and periop.nat.observability reads empty as
    missing, so every NAT build degrades to the no-op exporter. Tests that
    exercise the credentialed path set their own values on top of this."""
    for var in ("LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL"):
        monkeypatch.setenv(var, "")
