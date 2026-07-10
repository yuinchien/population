import { DETAIL_METRIC_KEYS, METRICS } from "./metrics.mjs";

export function buildDetailColumns({ currentYearIndex, metricFor }) {
  return [
    {
      key: "name",
      label: "Country",
      className: "country",
      defaultDirection: "asc",
      value: (country) => country.name,
      format: (value) => value,
    },
    ...DETAIL_METRIC_KEYS.map((key) => {
      const definition = METRICS[key];
      return {
        key,
        label: definition.detailLabel,
        className: "number",
        defaultDirection: definition.defaultDirection,
        value:
          key === "population"
            ? (country) => country.populations[currentYearIndex]
            : (country) => metricFor(country, key),
        format: definition.format,
      };
    }),
  ];
}

export function countryMatchesLegend(country, legend) {
  if (!legend) return false;
  return legend.mode === "income"
    ? country._incomeLabel === legend.label
    : country.region.trim() === legend.label;
}

export function filterDetailCountries(countries, legend) {
  return countries.filter((country) => countryMatchesLegend(country, legend));
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

export function selectDetailCountries({ countries, legend, columns, sort }) {
  return sortDetailCountries(
    filterDetailCountries(countries, legend),
    columns,
    sort,
  );
}

export function buildDetailRows(countries, columns) {
  const populationColumn =
    columns.find((column) => column.key === "population") ?? columns[0];
  const highestValue = Math.max(
    0,
    ...countries.map(populationColumn.value).filter(Number.isFinite),
  );

  return countries.map((country) => {
    const population = populationColumn.value(country);
    const ratio = highestValue > 0 ? population / highestValue : 0;
    return {
      country,
      ratio: Number.isFinite(ratio) ? ratio : 0,
      cells: columns.map((column) => ({
        key: column.key,
        className: column.className,
        text: column.format(column.value(country)),
      })),
    };
  });
}
