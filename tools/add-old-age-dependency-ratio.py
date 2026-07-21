#!/usr/bin/env python3
"""Add annual old-age dependency ratios to country-demographic-metrics.json.

The ratio is people ages 65+ per 100 working-age adults ages 15-64:

  oldAgeDependencyRatio = population(65+) / population(15-64) * 100

country-age-structure.json is stored on a five-year grid, so ratios are
calculated on that grid and linearly interpolated to the annual metric years.
Mirrors add-youth-dependency-ratio.py, which does the same for ages 0-14.
"""

from __future__ import annotations

import bisect
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AGE_STRUCTURE = ROOT / "public/data/country-age-structure.json"
OUTPUT = ROOT / "public/data/country-demographic-metrics.json"
OLD_AGE_GROUPS = {
    "65-69",
    "70-74",
    "75-79",
    "80-84",
    "85-89",
    "90-94",
    "95-99",
    "100+",
}
WORKING_AGE_GROUPS = {
    "15-19",
    "20-24",
    "25-29",
    "30-34",
    "35-39",
    "40-44",
    "45-49",
    "50-54",
    "55-59",
    "60-64",
}


def group_indices(age_groups: list[str], selected: set[str]) -> list[int]:
    indices = [index for index, label in enumerate(age_groups) if label in selected]
    missing = sorted(selected.difference(age_groups))
    if missing:
        raise SystemExit(f"Missing age groups: {', '.join(missing)}")
    return indices


def total_at(
    series: list[float | int],
    year_index: int,
    age_count: int,
    indices: list[int],
) -> float:
    start = year_index * age_count
    return float(sum(series[start + index] for index in indices))


def ratio_grid_for_country(
    country_age_structure: dict[str, list[float | int]],
    year_count: int,
    age_count: int,
    old_indices: list[int],
    working_indices: list[int],
) -> list[float | None]:
    ratios: list[float | None] = []
    male = country_age_structure["male"]
    female = country_age_structure["female"]
    for year_index in range(year_count):
        old_total = total_at(male, year_index, age_count, old_indices)
        old_total += total_at(female, year_index, age_count, old_indices)
        working_total = total_at(male, year_index, age_count, working_indices)
        working_total += total_at(female, year_index, age_count, working_indices)
        ratios.append(old_total / working_total * 100 if working_total else None)
    return ratios


def interpolate_ratio(
    target_year: int,
    grid_years: list[int],
    ratios: list[float | None],
) -> float | None:
    if target_year in grid_years:
        return ratios[grid_years.index(target_year)]

    right_index = bisect.bisect_right(grid_years, target_year)
    left_index = right_index - 1
    if left_index < 0 or right_index >= len(grid_years):
        return None

    left_year = grid_years[left_index]
    right_year = grid_years[right_index]
    left_value = ratios[left_index]
    right_value = ratios[right_index]
    if left_value is None or right_value is None:
        return None

    progress = (target_year - left_year) / (right_year - left_year)
    return left_value + (right_value - left_value) * progress


def main() -> None:
    metrics_payload = json.loads(OUTPUT.read_text())
    age_payload = json.loads(AGE_STRUCTURE.read_text())
    metric_years = metrics_payload["years"]
    grid_years = age_payload["years"]
    age_groups = age_payload["ageGroups"]
    age_count = len(age_groups)
    old_indices = group_indices(age_groups, OLD_AGE_GROUPS)
    working_indices = group_indices(age_groups, WORKING_AGE_GROUPS)

    missing: list[str] = []
    for iso3, metrics in metrics_payload["countries"].items():
        country_age_structure = age_payload["countries"].get(iso3)
        if not country_age_structure:
            missing.append(iso3)
            continue

        ratio_grid = ratio_grid_for_country(
            country_age_structure,
            len(grid_years),
            age_count,
            old_indices,
            working_indices,
        )
        series = [
            None
            if (value := interpolate_ratio(year, grid_years, ratio_grid)) is None
            else round(value, 3)
            for year in metric_years
        ]
        if any(value is None for value in series):
            missing.append(iso3)
        metrics["oldAgeDependencyRatio"] = series

    OUTPUT.write_text(json.dumps(metrics_payload, separators=(",", ":")))

    if missing:
        raise SystemExit(
            f"Missing old-age dependency ratios for: {', '.join(missing)}"
        )
    print(
        f"Added annual old-age dependency ratios for "
        f"{len(metrics_payload['countries'])} countries."
    )


if __name__ == "__main__":
    main()
