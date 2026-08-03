import { buildDetailRows, sortDetailCountries } from "./detail-table.mjs";
import {
  flagIconUrl,
  preloadFlagIcons,
} from "./data-loader.mjs";
import { renderFormattedText } from "./formatted-text.mjs";

export function createDetailCell(text, className = "", options = {}) {
  const cell = document.createElement("div");
  cell.className = `detail-cell ${className}`.trim();
  // Only real countries (an iso3 the flag-icons set actually has) get a
  // flag — header cells and aggregated group/region rows never pass
  // flagIso3, so they're unaffected.
  const flagUrl = options.flagIso3 ? flagIconUrl(options.flagIso3) : null;
  if (flagUrl) {
    const flag = document.createElement("span");
    flag.className = "detail-cell-flag";
    flag.style.backgroundImage = `url(${flagUrl})`;
    flag.setAttribute("aria-hidden", "true");
    cell.append(flag);
  }
  const inner = document.createElement("span");
  inner.className = "detail-name";
  renderFormattedText(inner, text);
  cell.append(inner);
  return cell;
}

export function ratioValueForBar(columns, barMetric, barValue) {
  if (barValue != null) return barValue;
  const metricColumn = columns.find((column) => column.key === barMetric);
  return metricColumn?.value;
}

// The first column (country name) is always the flexible one; every metric
// column after it gets an equal, narrower share. Works for any column
// count/selection — a single metric, a hand-picked subset, or the full
// list — since it's derived from how many columns there are, not from
// which metrics they happen to be.
//
// `compact` shrinks those per-column minimums for the chart table, which
// lives in .chart-view .detail-table's narrow clamp(280px, 32vw, 440px)
// sidebar column rather than the group-detail panel's full-width table —
// the normal 240px/180px minimums alone exceed that column's own minimum
// width even at just 2 columns (Country + one metric), forcing the whole
// column (including the country-picker chips above it, which share the
// same CSS Grid track) into perpetual horizontal overflow.
function gridTemplateColumnsFor(columnCount, { compact = false } = {}) {
  const metricColumnCount = Math.max(0, columnCount - 1);
  const nameMin = compact ? "120px" : "240px";
  const metricMin = compact ? "90px" : "180px";
  return `minmax(${nameMin}, 1fr) repeat(${metricColumnCount}, minmax(${metricMin}, 0.8fr))`;
}

// Shared by the group-detail table and the chart table: builds sortable
// header cells (with the active sort's arrow) and per-country rows from the
// same column/row-building helpers, wiring header clicks to onSort and row
// clicks to onRowClick. Sorting happens here rather than being the caller's
// job, so both tables stay correct even if handed an unsorted country list.
export function renderSortableTable({
  headerEl,
  rowsEl,
  columns,
  sort,
  countries,
  onSort,
  onRowClick,
  // Optional: per-row --detail-color (tints .detail-cell.country's ratio
  // bar — see styles.css). Left unset, rows just inherit the surrounding
  // panel color.
  colorFor,
  barMode = "country-cell",
  barMetric = "population",
  barValue,
  compact = false,
}) {
  const gridTemplateColumns = gridTemplateColumnsFor(columns.length, {
    compact,
  });
  headerEl.style.gridTemplateColumns = gridTemplateColumns;
  headerEl.replaceChildren(
    ...columns.map((column) => {
      const arrow =
        sort.key === column.key
          ? sort.direction === "asc"
            ? " ↑"
            : " ↓"
          : "";
      const cell = createDetailCell(
        `${column.label}${arrow}`,
        `${column.className} sortable`,
      );
      cell.classList.toggle("active", sort.key === column.key);
      cell.dataset.sortKey = column.key;
      return cell;
    }),
  );
  headerEl.onclick = (event) => {
    const cell = event.target.closest("[data-sort-key]");
    if (!cell || !headerEl.contains(cell)) return;
    onSort(cell.dataset.sortKey);
  };
  // The header row has no vertical content of its own to scroll, so a plain
  // (non-shift) mouse wheel over it is otherwise wasted — repurposed here to
  // pan the table horizontally, since that's the one gesture an ordinary
  // vertical-only wheel can't already reach (rows still take priority for
  // vertical scrolling; a real horizontal swipe/shift+wheel over the rows
  // already chains up to the table natively without any of this).
  headerEl.onwheel = (event) => {
    if (event.deltaX !== 0 || event.deltaY === 0) return;
    const table = headerEl.closest(".detail-table");
    if (!table) return;
    event.preventDefault();
    table.scrollLeft += event.deltaY;
  };

  const sorted = sortDetailCountries(countries, columns, sort);
  // detailRow.country isn't always a real country (the chart table can show
  // aggregated region/income rows too) — flagIconUrl already no-ops on a
  // missing/invalid iso3, so this is safe either way.
  preloadFlagIcons(sorted.map((country) => country.iso3).filter(Boolean));
  const ratioValue =
    barMode === "none" ? undefined : ratioValueForBar(columns, barMetric, barValue);
  const rows = buildDetailRows(sorted, columns, { ratioValue }).map(
    (detailRow, index) => {
      const row = document.createElement("div");
      row.dataset.rowIndex = String(index);
      row.className = "detail-row";
      row.style.gridTemplateColumns = gridTemplateColumns;
      if (colorFor) {
        const color = colorFor(detailRow.country);
        if (color) row.style.setProperty("--detail-color", color);
      }
      row.append(
        ...detailRow.cells.map((cell) =>
          createDetailCell(cell.text, cell.className, {
            ratio:
              barMode === "country-cell" && cell.key === "name"
                ? detailRow.ratio
                : null,
            flagIso3: cell.key === "name" ? detailRow.country?.iso3 : null,
          }),
        ),
      );
      return row;
    },
  );
  rowsEl.onclick = (event) => {
    const row = event.target.closest("[data-row-index]");
    if (!row || !rowsEl.contains(row)) return;
    // `sorted` holds plain countries (not the {country, ratio, cells} rows
    // built above) — named distinctly from that wrapper to avoid confusing
    // the two.
    const country = sorted[Number(row.dataset.rowIndex)];
    if (country) onRowClick(country);
  };
  rowsEl.replaceChildren(...rows);
}

// Shared asc/desc toggle: clicking the already-active column flips
// direction; clicking a different one switches to that column's own
// default direction (e.g. population defaults to desc, country name to
// asc). Returns null for an unrecognized key so callers can skip the
// re-render rather than sorting by a column that doesn't exist.
export function nextSortState(sort, key, columns) {
  const column = columns.find((c) => c.key === key);
  if (!column) return null;
  return sort.key === key
    ? { key, direction: sort.direction === "asc" ? "desc" : "asc" }
    : { key, direction: column.defaultDirection };
}
