"""CLI client plumbing (spec v2 §3 seam, CLI companion).

The CLI is a thin HTTP client over the same FastAPI app the browser uses —
remote when an API URL is given, otherwise auto-hosted on an ephemeral
localhost port for the life of the command. These tests pin the transport:
real HTTP either way, the app lifespan entered (so the NAT session exists,
v2-nat §3.2), and the SSE vocabulary parsed as the UI parses it.
"""

import json

import httpx
import pytest

from periop.api.app import create_app
from periop.cli.client import ApiError, check, iter_sse, open_client, serve_app

PROVIDERS = [{"provider_id": "p-lim", "name": "Dr A. Lim", "role": "consultant"}]


@pytest.fixture
def app(tmp_path):
    providers = tmp_path / "providers.json"
    providers.write_text(json.dumps(PROVIDERS))
    return create_app(
        out_dir=tmp_path / "_out",
        case_dir=tmp_path,
        providers_path=providers,
        runner=object(),  # transport tests never run a stage
    )


class TestServeApp:
    def test_serves_over_real_http_with_lifespan(self, app):
        with serve_app(app) as base_url:
            assert base_url.startswith("http://127.0.0.1:")
            resp = httpx.get(f"{base_url}/api/health")
            assert resp.status_code == 200
            assert resp.json() == {"status": "ok"}
            # lifespan entered: live stage runs would execute inside the NAT
            # session (v2-nat §3.2), same as the browser-facing server
            assert app.state.nat_sessions is not None

    def test_server_stops_on_exit(self, app):
        with serve_app(app) as base_url:
            pass
        with pytest.raises(httpx.ConnectError):
            httpx.get(f"{base_url}/api/health", timeout=2)


class TestOpenClient:
    def test_remote_mode_targets_the_given_url(self, app):
        with serve_app(app) as base_url, open_client(base_url) as client:
            assert client.get("/api/health").status_code == 200

    def test_auto_hosted_mode_boots_the_app_from_env(self, tmp_path, monkeypatch):
        providers = tmp_path / "providers.json"
        providers.write_text(json.dumps(PROVIDERS))
        monkeypatch.setenv("PERIOP_CASE_DIR", str(tmp_path))
        monkeypatch.setenv("PERIOP_OUT_DIR", str(tmp_path / "_out"))
        monkeypatch.setenv("PERIOP_PROVIDERS", str(providers))
        monkeypatch.setenv("PERIOP_STUB_RUNNER", "1")
        with open_client(None) as client:
            assert client.get("/api/health").status_code == 200
            assert client.get("/api/providers").json() == PROVIDERS

    def test_no_read_timeout_for_minutes_long_stage_runs(self, app):
        with serve_app(app) as base_url, open_client(base_url) as client:
            assert client.timeout.read is None


class TestCheck:
    def test_passes_success_through(self, app):
        with serve_app(app) as base_url, open_client(base_url) as client:
            resp = check(client.get("/api/health"))
            assert resp.json() == {"status": "ok"}

    def test_raises_api_error_with_the_servers_next_action_detail(self, app):
        with serve_app(app) as base_url, open_client(base_url) as client:
            with pytest.raises(ApiError) as exc:
                check(client.get("/api/cases/nope"))
        assert exc.value.status == 404
        assert "no such case: nope" in str(exc.value)

    def test_tolerates_non_json_error_bodies(self):
        resp = httpx.Response(502, text="bad gateway", request=httpx.Request("GET", "http://x"))
        with pytest.raises(ApiError) as exc:
            check(resp)
        assert exc.value.status == 502
        assert "bad gateway" in str(exc.value)


class TestIterSse:
    def test_parses_event_data_pairs(self):
        lines = [
            "event: agent_start",
            'data: {"stage": "preop", "agent": "PreOpNoteWriter"}',
            "",
            "event: complete",
            'data: {"case_id": "c1"}',
            "",
        ]
        assert list(iter_sse(lines)) == [
            ("agent_start", {"stage": "preop", "agent": "PreOpNoteWriter"}),
            ("complete", {"case_id": "c1"}),
        ]

    def test_ignores_comments_and_blank_lines(self):
        lines = [": keep-alive", "", "event: status", 'data: {"message": "hi"}', ""]
        assert list(iter_sse(lines)) == [("status", {"message": "hi"})]
