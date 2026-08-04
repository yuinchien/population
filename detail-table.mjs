import { DETAIL_METRIC_KEYS, METRICS } from "./metrics.mjs";
import {
  matchesAgeCategory,
  matchesMigrationCategory,
} from "./detail-group-categories.mjs";

export function buildDetailColumns({
  currentYearIndex,
  metricFor,
  metricKeys = DETAIL_METRIC_KEYS,
  populationFor = (country) => country.populations[currentYearIndex],
  // Overrides the Population column's header for curated groupings whose
  // "population" is a subgroup headcount (e.g. "Older population"), not the
  // country total the label otherwise implies.
  populationLabel,
}) {
  return [
    {
      key: "name",
      label: "Country",
      className: "country",
      defaultDirection: "asc",
      value: (country) => country.name,
      format: (value) => value,
    },
    ...metricKeys.map((key) => {
      const definition = METRICS[key];
      return {
        key,
        label:
          key === "population"
            ? (populationLabel ?? definition.detailLabel)
            : definition.detailLabel,
        className: "number",
        defaultDirection: definition.defaultDirection,
        value:
          key === "population"
            ? populationFor
            : (country) => metricFor(country, key),
        // Appends the metric's unit suffix (%, ‰) to the table cell only —
        // formatPanel/narrative text spell the unit out in words instead
        // ("per 100", "per 1,000"), so this stays local to the table.
        format: (value) => {
          const formatted = definition.format(value);
          return definition.tableSuffix && formatted !== "N/A"
            ? `${formatted}<span class="suffix">${definition.tableSuffix}</span>`
            : formatted;
        },
      };
    }),
  ];
}

// `metricFor(country, key)` is only consulted for the "age"/"migration"
// modes — region/income match a static field, so existing callers that
// never select those groupings can omit it.
export function countryMatchesLegend(country, legend, metricFor) {
  if (!legend) return false;
  if (legend.mode === "income") return country._incomeLabel === legend.key;
  if (legend.mode === "region") return country.region?.trim() === legend.key;
  if (legend.mode === "age") {
    return matchesAgeCategory(legend.key, {
      olderPopulationShare: metricFor(country, "olderPopulationShare"),
      youthDependencyRatio: metricFor(country, "youthDependencyRatio"),
    });
  }
  if (legend.mode === "migration") {
    return matchesMigrationCategory(legend.key, {
      netMigrationRate: metricFor(country, "netMigrationRate"),
    });
  }
  return false;
}

// The group-detail panel's active filters: independently toggleable, at
// most one per group (age/migration/region/income), combined with AND
// across groups — a country has to pass every active filter's own
// single-legend test, not just one of them.
export function countryMatchesAllFilters(country, legends, metricFor) {
  return legends.every((legend) =>
    countryMatchesLegend(country, legend, metricFor),
  );
}

export function sortDetailCountries(countries, columns, sort) {
  const column =
    columns.find((candidate) => candidate.key === sort.key) ??
    columns.find((candidate) => candidate.key === "population") ??
    columns[0];
  const sign = sort.direction === "asc" ? 1 : -1;

  return [...countries].sort((a, b) => {
    const aValue = column.value(a);
    const bValue = column.value(b);
    if (aValue == null && bValue == null) return a.name.localeCompare(b.name);
    if (aValue == null) return 1;
    if (bValue == null) return -1;
    if (aValue !== bValue) {
      return typeof aValue === "string"
        ? aValue.localeCompare(bValue) * sign
        : (aValue - bValue) * sign;
    }
    return a.name.localeCompare(b.name);
  });
}

export function buildDetailRows(countries, columns, options = {}) {
  const populationColumn =
    columns.find((column) => column.key === "population") ?? columns[0];
  const ratioValue = options.ratioValue ?? populationColumn.value;
  const ratioValues = countries.map((country) => {
    const value = ratioValue(country);
    return Number.isFinite(value) ? value : 0;
  });
  const highestValue = Math.max(
    0,
    ...ratioValues,
  );
  return countries.map((country, index) => {
    const population = ratioValues[index];
    const ratio = highestValue > 0 ? population / highestValue : 0;
    const boundedRatio = Math.min(1, Math.max(0, ratio));
    return {
      country,
      ratio: Number.isFinite(boundedRatio) ? boundedRatio : 0,
      cells: columns.map((column) => ({
        key: column.key,
        className: column.className,
        text: column.format(column.value(country)),
        value: column.value(country),
      })),
    };
  });
}
