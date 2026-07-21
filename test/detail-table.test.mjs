import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDetailColumns,
  buildDetailRows,
  filterDetailCountries,
  selectDetailCountries,
} from "../detail-table.mjs";

const countries = [
  country("Borduria", "High-income countries", "Europe", {
    populations: [4_000_000, 5_000_000],
    populationGrowth: [0.2, 0.1],
    fertility: [1.7, 1.6],
  }),
  country("Aland", "High-income countries", "Europe", {
    populations: [8_000_000, 9_000_000],
    populationGrowth: [null, null],
    fertility: [1.9, 1.8],
  }),
  country("Calistan", "Middle-income countries", "Asia", {
    populations: [12_000_000, 13_000_000],
    populationGrowth: [1.1, 1.0],
    fertility: [2.4, 2.3],
  }),
];

test("filterDetailCountries filters by region or income legend", () => {
  assert.deepEqual(
    filterDetailCountries(countries, {
      mode: "region",
      label: "Europe",
    }).map((entry) => entry.name),
    ["Borduria", "Aland"],
  );

  assert.deepEqual(
    filterDetailCountries(countries, {
      mode: "income",
      label: "Middle-income countries",
    }).map((entry) => entry.name),
    ["Calistan"],
  );
});

test("selectDetailCountries sorts values without mutating the source list", () => {
  const columns = buildDetailColumns({
    currentYearIndex: 1,
    metricFor: metricForYear(1),
  });
  const selected = selectDetailCountries({
    countries,
    legend: { mode: "region", label: "Europe" },
    columns,
    sort: { key: "population", direction: "desc" },
  });

  assert.deepEqual(
    selected.map((entry) => entry.name),
    ["Aland", "Borduria"],
  );
  assert.deepEqual(
    countries.map((entry) => entry.name),
    ["Borduria", "Aland", "Calistan"],
  );
});

test("selectDetailCountries puts missing metric values last", () => {
  const columns = buildDetailColumns({
    currentYearIndex: 1,
    metricFor: metricForYear(1),
  });
  const selected = selectDetailCountries({
    countries,
    legend: { mode: "region", label: "Europe" },
    columns,
    sort: { key: "populationGrowth", direction: "desc" },
  });

  assert.deepEqual(
    selected.map((entry) => entry.name),
    ["Borduria", "Aland"],
  );
});

test("buildDetailRows formats cells and computes population ratios", () => {
  const columns = buildDetailColumns({
    currentYearIndex: 0,
    metricFor: metricForYear(0),
  });
  const rows = buildDetailRows([countries[1], countries[0]], columns);

  assert.equal(rows[0].ratio, 1);
  assert.equal(rows[1].ratio, 0.5);
  assert.deepEqual(
    rows[0].cells.map((cell) => cell.text),
    ["Aland", "8,000,000", "N/A", "1.9", "N/A", "N/A", "N/A", "N/A"],
  );
});

test("buildDetailRows clamps population ratios to the drawable range", () => {
  const columns = [
    {
      key: "name",
      label: "Country",
      className: "country",
      value: (entry) => entry.name,
      format: (value) => value,
    },
    {
      key: "population",
      label: "Population",
      className: "number",
      value: (entry) => entry.population,
      format: String,
    },
  ];
  const rows = buildDetailRows(
    [
      { name: "Positive", population: 100 },
      { name: "Negative", population: -20 },
    ],
    columns,
  );

  assert.equal(rows[0].ratio, 1);
  assert.equal(rows[1].ratio, 0);
});

test("buildDetailRows can compute ratios from hidden population values", () => {
  const columns = [
    {
      key: "name",
      label: "Country",
      className: "country",
      value: (entry) => entry.name,
      format: (value) => value,
    },
    {
      key: "ageDependencyRatio",
      label: "Dependency ratio",
      className: "number",
      value: (entry) => entry.ageDependencyRatio,
      format: String,
    },
  ];
  const rows = buildDetailRows(
    [
      { name: "Large", population: 200, ageDependencyRatio: 55 },
      { name: "Small", population: 50, ageDependencyRatio: 80 },
    ],
    columns,
    { ratioValue: (entry) => entry.population },
  );

  assert.equal(rows[0].ratio, 1);
  assert.equal(rows[1].ratio, 0.25);
});

function country(name, incomeLabel, region, metrics) {
  return {
    name,
    _incomeLabel: incomeLabel,
    region,
    populations: metrics.populations,
    metrics,
  };
}

function metricForYear(yearIndex) {
  return (testCountry, key) => testCountry.metrics[key]?.[yearIndex];
}
