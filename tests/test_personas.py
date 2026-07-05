"""Persona sampling tests (spec §5).

Sampling is stratified across age bands and sexes so the eval set reflects
the population served, and deterministic (seeded) so a committed sample is
reproducible. Note: the published Nemotron-Personas-Singapore schema has no
healthcare_persona/ethnicity fields (spec §5 drift) — we stratify on
age band × sex.
"""

import json

import pytest

from periop.synthgen.personas import AGE_BANDS, Persona, age_band, load_personas, stratified_sample


def make_persona(uuid: str, age: int, sex: str) -> Persona:
    return Persona(
        uuid=uuid,
        persona=f"Persona {uuid}, a {age}-year-old.",
        cultural_background="Grew up in Bedok.",
        sex=sex,
        age=age,
        marital_status="Single",
        education_level="Secondary",
        occupation="Technician",
        planning_area="Bedok",
    )


class TestAgeBand:
    def test_bands_cover_adult_range(self):
        assert age_band(21) == "18-35"
        assert age_band(40) == "36-50"
        assert age_band(60) == "51-65"
        assert age_band(78) == "66+"

    def test_band_labels_match_constant(self):
        assert [age_band(a) for a in (20, 40, 60, 80)] == list(AGE_BANDS)


class TestStratifiedSample:
    @pytest.fixture
    def pool(self):
        pool = []
        for band_idx, age in enumerate((25, 45, 60, 75)):
            for sex in ("Female", "Male"):
                for i in range(5):
                    pool.append(make_persona(f"u{band_idx}-{sex}-{i}", age + i % 3, sex))
        return pool

    def test_samples_evenly_across_strata(self, pool):
        sample = stratified_sample(pool, per_stratum=2, seed=7)
        assert len(sample) == 16  # 4 bands × 2 sexes × 2
        strata = {(age_band(p.age), p.sex) for p in sample}
        assert len(strata) == 8

    def test_deterministic_for_same_seed(self, pool):
        a = stratified_sample(pool, per_stratum=2, seed=7)
        b = stratified_sample(pool, per_stratum=2, seed=7)
        assert [p.uuid for p in a] == [p.uuid for p in b]

    def test_different_seed_changes_selection(self, pool):
        a = stratified_sample(pool, per_stratum=2, seed=7)
        b = stratified_sample(pool, per_stratum=2, seed=8)
        assert [p.uuid for p in a] != [p.uuid for p in b]

    def test_short_stratum_takes_all_available(self, pool):
        sample = stratified_sample(pool, per_stratum=10, seed=7)
        assert len(sample) == 40  # entire pool, no duplication

    def test_ignores_minors(self):
        pool = [make_persona("kid", 12, "Male"), make_persona("adult", 30, "Male")]
        sample = stratified_sample(pool, per_stratum=5, seed=1)
        assert [p.uuid for p in sample] == ["adult"]


class TestLoadPersonas:
    def test_loads_jsonl_ignoring_unknown_fields(self, tmp_path):
        path = tmp_path / "personas.jsonl"
        record = make_persona("u1", 30, "Female").model_dump()
        record["sports_persona"] = "Plays golf."  # extra dataset field
        path.write_text(json.dumps(record) + "\n")
        personas = load_personas(path)
        assert len(personas) == 1
        assert personas[0].uuid == "u1"
