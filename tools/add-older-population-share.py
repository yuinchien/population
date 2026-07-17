#!/usr/bin/env python3
"""Add WPP 65+ population shares to country-demographic-metrics.json.

Usage:
  python3 tools/add-older-population-share.py \
    /path/to/WPP2024_POP_F03_1_POPULATION_SELECT_AGE_GROUPS_BOTH_SEXES.xlsx
"""

from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/data/country-demographic-metrics.json"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
CELL_COLUMN = re.compile(r"[A-Z]+")


def shared_strings(archive: zipfile.ZipFile) -> list[str]:
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    return ["".join(item.itertext()) for item in root]


def cell_value(cell: ET.Element, strings: list[str]):
    value = cell.find(f"{NS}v")
    if value is None or value.text is None:
        return None
    if cell.get("t") == "s":
        return strings[int(value.text)]
    return float(value.text)


def read_sheet(
    archive: zipfile.ZipFile,
    path: str,
    strings: list[str],
    valid_iso3: set[str],
    valid_years: set[int],
) -> dict[str, dict[int, float]]:
    shares: dict[str, dict[int, float]] = {}
    with archive.open(path) as source:
        for _, element in ET.iterparse(source, events=("end",)):
            if element.tag != f"{NS}row":
                continue
            row_number = int(element.get("r", 0))
            if row_number <= 17:
                element.clear()
                continue

            cells = {
                CELL_COLUMN.match(cell.get("r", "")).group(): cell_value(cell, strings)
                for cell in element.findall(f"{NS}c")
                if CELL_COLUMN.match(cell.get("r", ""))
            }
            iso3 = cells.get("F")
            year_value = cells.get("K")
            total = cells.get("L")
            older = cells.get("BK")
            if (
                iso3 in valid_iso3
                and year_value is not None
                and total
                and older is not None
            ):
                year = int(year_value)
                if year in valid_years:
                    shares.setdefault(iso3, {})[year] = round(older / total * 100, 3)
            element.clear()
    return shares


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Pass the WPP selected-age-groups .xlsx path.")

    workbook = Path(sys.argv[1])
    payload = json.loads(OUTPUT.read_text())
    years = payload["years"]
    valid_years = set(years)
    valid_iso3 = set(payload["countries"])

    with zipfile.ZipFile(workbook) as archive:
        strings = shared_strings(archive)
        estimates = read_sheet(
            archive,
            "xl/worksheets/sheet7.xml",
            strings,
            valid_iso3,
            {year for year in valid_years if year <= 2023},
        )
        projections = read_sheet(
            archive,
            "xl/worksheets/sheet8.xml",
            strings,
            valid_iso3,
            {year for year in valid_years if year >= 2024},
        )

    missing = []
    for iso3, metrics in payload["countries"].items():
        values = {**estimates.get(iso3, {}), **projections.get(iso3, {})}
        series = [values.get(year) for year in years]
        if any(value is None for value in series):
            missing.append(iso3)
        metrics["olderPopulationShare"] = series

    payload["sourceFiles"] = [
        payload.pop("sourceFile", "WPP2024_GEN_F01_DEMOGRAPHIC_INDICATORS_FULL.xlsx"),
        "WPP2024_POP_F03_1_POPULATION_SELECT_AGE_GROUPS_BOTH_SEXES.xlsx",
    ]
    OUTPUT.write_text(json.dumps(payload, separators=(",", ":")))

    if missing:
        raise SystemExit(f"Missing annual 65+ shares for: {', '.join(missing)}")
    print(f"Added annual 65+ shares for {len(valid_iso3)} countries.")


if __name__ == "__main__":
    main()
