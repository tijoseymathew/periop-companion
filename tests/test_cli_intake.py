"""Workflow CLI intake commands: create, add-document, questions, approve.

The API owns every rule (slug uniqueness, doc types, the GapAnalyst auto-run,
demo-case immutability, the question gate) — these tests pin that the CLI
forwards inputs faithfully and surfaces the API's next-action copy verbatim.
"""

from tests.test_cli_main import api, make_demo_case, run_cli  # noqa: F401

OP_PLAN = "Elective right hip repair under GA."
GP_SUMMARY = "Aspirin 100 mg daily. Hypertension, well controlled."


def create_case(api, capsys, label="Hip repair") -> str:
    code, out, _ = run_cli(api, "create", label, "--provider", "p-lim", capsys=capsys)
    assert code == 0
    return out.strip().splitlines()[-1]


class TestCreate:
    def test_creates_a_live_case_and_prints_its_id(self, api, capsys):
        _, store, _ = api
        case_id = create_case(api, capsys)
        assert case_id == "hip-repair"
        case = store.load(case_id)
        assert case.workflow is not None
        assert case.workflow.created_by.provider_id == "p-lim"

    def test_same_label_twice_gets_a_distinct_id(self, api, capsys):
        assert create_case(api, capsys) == "hip-repair"
        assert create_case(api, capsys) == "hip-repair-2"

    def test_unknown_provider_exits_1(self, api, capsys):
        code, _, err = run_cli(api, "create", "X", "--provider", "p-nope", capsys=capsys)
        assert code == 1
        assert "no such provider: p-nope" in err


class TestAddDocument:
    def test_pastes_text_and_reports_chunks(self, api, capsys):
        case_id = create_case(api, capsys)
        code, out, _ = run_cli(
            api, "add-document", case_id, "gp-summary", "--text", GP_SUMMARY,
            "--provider", "p-lim", capsys=capsys,
        )
        assert code == 0
        assert "doc:gp-summary" in out
        _, store, _ = api
        assert store.load(case_id).get_source("doc:gp-summary").chunks

    def test_uploads_a_file(self, api, capsys, tmp_path):
        case_id = create_case(api, capsys)
        doc = tmp_path / "plan.md"
        doc.write_text(OP_PLAN)
        code, out, _ = run_cli(
            api, "add-document", case_id, "op-plan", str(doc),
            "--provider", "p-lim", capsys=capsys,
        )
        assert code == 0
        assert "doc:op-plan" in out

    def test_gap_analysis_launches_in_background_once_op_plan_and_record_exist(
        self, api, capsys
    ):
        case_id = create_case(api, capsys)
        run_cli(api, "add-document", case_id, "gp-summary", "--text", GP_SUMMARY,
                "--provider", "p-lim", capsys=capsys)
        code, out, _ = run_cli(
            api, "add-document", case_id, "op-plan", "--text", OP_PLAN,
            "--provider", "p-lim", capsys=capsys,
        )
        assert code == 0
        # v2-speed §3.2: prep left the request path, so add-document points at
        # the read command rather than blocking for the questions
        # (v2 §6.2: the screen explains itself — so does the CLI)
        assert "Preparing interview questions in the background" in out
        assert f"periop questions {case_id}" in out

    def test_demo_cases_refuse_writes_with_the_api_detail(self, api, capsys):
        _, store, _ = api
        store.save(make_demo_case())
        code, _, err = run_cli(
            api, "add-document", "sg-0001", "gp-summary", "--text", "x",
            "--provider", "p-lim", capsys=capsys,
        )
        assert code == 1
        assert "seeded demo data" in err


def intake_to_questions(api, capsys) -> str:
    case_id = create_case(api, capsys)
    run_cli(api, "add-document", case_id, "gp-summary", "--text", GP_SUMMARY,
            "--provider", "p-lim", capsys=capsys)
    run_cli(api, "add-document", case_id, "op-plan", "--text", OP_PLAN,
            "--provider", "p-lim", capsys=capsys)
    return case_id


class TestQuestions:
    def test_lists_questions_with_indices_and_review_state(self, api, capsys):
        case_id = intake_to_questions(api, capsys)
        code, out, _ = run_cli(api, "questions", case_id, capsys=capsys)
        assert code == 0
        assert "0" in out and "[unreviewed]" in out
        assert "Is the patient still taking aspirin?" in out

    def test_approve_passes_the_question_gate(self, api, capsys):
        case_id = intake_to_questions(api, capsys)
        code, out, _ = run_cli(
            api, "approve-questions", case_id, "--provider", "p-lim", capsys=capsys
        )
        assert code == 0
        assert "1 approved" in out
        _, store, _ = api
        case = store.load(case_id)
        assert case.workflow.stages["preop"].questions_approved_at is not None
        assert all(q.review == "approved" for q in case.open_questions)

    def test_dismissals_are_kept_not_deleted(self, api, capsys):
        case_id = intake_to_questions(api, capsys)
        code, out, _ = run_cli(
            api, "approve-questions", case_id, "--dismiss", "0",
            "--provider", "p-lim", capsys=capsys,
        )
        assert code == 0
        assert "1 dismissed" in out
        _, store, _ = api
        case = store.load(case_id)
        assert [q.review for q in case.open_questions] == ["dismissed"]
