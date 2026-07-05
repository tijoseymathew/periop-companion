"""Persona sampling from Nemotron-Personas-Singapore (spec §5).

The published dataset has no healthcare_persona or ethnicity field, so
stratification runs on age band × sex. Sampling is seeded and deterministic
so the committed sample is reproducible.
"""

import json
import random
from pathlib import Path

from pydantic import BaseModel, ConfigDict

AGE_BANDS = ("18-35", "36-50", "51-65", "66+")
SEXES = ("Female", "Male")


class Persona(BaseModel):
    """The subset of Nemotron-Personas-Singapore fields the pipeline uses."""

    model_config = ConfigDict(extra="ignore")

    uuid: str
    persona: str
    cultural_background: str
    sex: str
    age: int
    marital_status: str
    education_level: str
    occupation: str
    planning_area: str


def age_band(age: int) -> str:
    if age <= 35:
        return "18-35"
    if age <= 50:
        return "36-50"
    if age <= 65:
        return "51-65"
    return "66+"


def stratified_sample(personas: list[Persona], per_stratum: int, seed: int) -> list[Persona]:
    """Sample up to ``per_stratum`` adults from each age-band × sex stratum."""
    rng = random.Random(seed)
    sample: list[Persona] = []
    for band in AGE_BANDS:
        for sex in SEXES:
            stratum = [p for p in personas if p.age >= 18 and age_band(p.age) == band and p.sex == sex]
            rng.shuffle(stratum)
            sample.extend(stratum[:per_stratum])
    return sample


def load_personas(path: Path | str) -> list[Persona]:
    lines = Path(path).read_text().splitlines()
    return [Persona.model_validate(json.loads(line)) for line in lines if line.strip()]
