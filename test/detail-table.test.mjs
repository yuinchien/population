import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDetailColumns,
  buildDetailRows,
  countryMatchesAllFilters,
  countryMatchesLegend,
  sortDetailCountries,
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

test("countryMatchesLegend classifies by age category using current-year metrics", () => {
  const metricFor = (testCountry, key) => testCountry.metrics[key]?.[0];
  const superAged = country("SuperAgedLand", "High-income countries", "Europe", {
    populations: [1],
    olderPopulationShare: [25],
  });
  const aging = country("AgingLand", "High-income countries", "Europe", {
    populations: [1],
    olderPopulationShare: [10],
  });
  const notAging = country("YoungLand", "High-income countries", "Europe", {
    populations: [1],
    olderPopulationShare: [3],
  });
  const youngDependency = country("DependencyLand", "High-income countries", "Europe", {
    populations: [1],
    olderPopulationShare: [3],
    youthDependencyRatio: [75],
  });

  assert.equal(
    countryMatchesLegend(superAged, { mode: "age", key: "superAged" }, metricFor),
    true,
  );
  assert.equal(
    countryMatchesLegend(aging, { mode: "age", key: "superAged" }, metricFor),
    false,
  );
  assert.equal(
    countryMatchesLegend(aging, { mode: "age", key: "aging" }, metricFor),
    true,
  );
  assert.equal(
    countryMatchesLegend(notAging, { mode: "age", key: "aging" }, metricFor),
    false,
  );
  assert.equal(
    countryMatchesLegend(
      youngDependency,
      { mode: "age", key: "youngDependency" },
      metricFor,
    ),
    true,
  );
});

test("countryMatchesLegend classifies by migration category using current-year metrics", () => {
  const metricFor = (testCountry, key) => testCountry.metrics[key]?.[0];
  const inflow = country("InflowLand", "High-income countries", "Europe", {
    populations: [1],
    netMigrationRate: [3.2],
  });
  const outflow = country("OutflowLand", "High-income countries", "Europe", {
    populations: [1],
    netMigrationRate: [-1.4],
  });

  assert.equal(
    countryMatchesLegend(inflow, { mode: "migration", key: "inflow" }, metricFor),
    true,
  );
  assert.equal(
    countryMatchesLegend(outflow, { mode: "migration", key: "inflow" }, metricFor),
    false,
  );
  assert.equal(
    countryMatchesLegend(outflow, { mode: "migration", key: "outflow" }, metricFor),
    true,
  );
});

test("countryMatchesAllFilters requires every active filter to match (AND across groups)", () => {
  const metricFor = (testCountry, key) => testCountry.metrics[key]?.[0];
  const agedEurope = country("AgedEuropia", "High-income countries", "Europe", {
    populations: [1],
    olderPopulationShare: [25],
  });
  const agedAsia = country("AgedAsiana", "High-income countries", "Asia", {
    populations: [1],
    olderPopulationShare: [25],
  });

  const regionFilter = { mode: "region", key: "Europe", label: "Europe" };
  const ageFilter = { mode: "age", key: "superAged", label: "Super-aged society" };

  assert.equal(
    countryMatchesAllFilters(agedEurope, [regionFilter, ageFilter], metricFor),
    true,
  );
  assert.equal(
    countryMatchesAllFilters(agedAsia, [regionFilter, ageFilter], metricFor),
    false,
  );
  // No active filters at all — nothing to fail, so everything passes.
  assert.equal(countryMatchesAllFilters(agedAsia, [], metricFor), true);
});

test("sortDetailCountries sorts values without mutating the source list", () => {
  const columns = buildDetailColumns({
    currentYearIndex: 1,
    metricFor: metricForYear(1),
  });
  const europe = countries.filter((entry) => entry.region === "Europe");
  const sorted = sortDetailCountries(europe, columns, {
    key: "population",
    direction: "desc",
  });

  assert.deepEqual(
    sorted.map((entry) => entry.name),
    ["Aland", "Borduria"],
  );
  assert.deepEqual(
    countries.map((entry) => entry.name),
    ["Borduria", "Aland", "Calistan"],
  );
});

test("sortDetailCountries puts missing metric values last", () => {
  const columns = buildDetailColumns({
    currentYearIndex: 1,
    metricFor: metricForYear(1),
  });
  const europe = countries.filter((entry) => entry.region === "Europe");
  const sorted = sortDetailCountries(europe, columns, {
    key: "populationGrowth",
    direction: "desc",
  });

  assert.deepEqual(
    sorted.map((entry) => entry.name),
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
    [
      "Aland",
      "8,000,000",
      "N/A",
      "N/A",
      "1.9",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      "N/A",
    ],
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

test("buildDetailColumns appends each metric's table unit suffix (%, ‰) but never to N/A", () => {
  const metricFor = (testCountry, key) => testCountry.metrics[key]?.[0];
  const columns = buildDetailColumns({ currentYearIndex: 0, metricFor });
  const format = (key, value) =>
    columns.find((column) => column.key === key).format(value);

  assert.equal(
    format("ageDependencyRatio", 64.7),
    '64.7<span class="suffix">%</span>',
  );
  assert.equal(
    format("oldAgeDependencyRatio", 48.6),
    '48.6<span class="suffix">%</span>',
  );
  assert.equal(
    format("youthDependencyRatio", 16.2),
    '16.2<span class="suffix">%</span>',
  );
  assert.equal(
    format("netMigrationRate", -0.1),
    '-0.1<span class="suffix">‰</span>',
  );
  // populationGrowth already bakes its own <span class="suffix">%</span>
  // into formatPercent — no additional suffix should be layered on top.
  assert.equal(
    format("populationGrowth", -0.69),
    '-0.69<span class="suffix">%</span>',
  );
  // Metrics without a tableSuffix (counts, "yrs", fertility) stay as-is.
  assert.equal(format("population", 1_000), "1,000");
  assert.equal(format("fertility", 1.2), "1.2");
  // Missing values must not gain a stray suffix on top of "N/A".
  assert.equal(format("ageDependencyRatio", null), "N/A");
  assert.equal(format("netMigrationRate", null), "N/A");
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
