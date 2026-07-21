import { buildDetailRows, sortDetailCountries } from "./detail-table.mjs";

export function createDetailCell(text, className = "", options = {}) {
  const cell = document.createElement("div");
  cell.className = `detail-cell ${className}`.trim();
  if (options.ratio != null) {
    const bar = document.createElement("span");
    bar.className = "detail-ratio-bar";
    bar.style.width = `${Math.min(1, Math.max(0, options.ratio)) * 100}%`;
    cell.append(bar);
  }
  const inner = document.createElement("span");
  inner.className = "detail-name";
  inner.textContent = text;
  cell.append(inner);
  return cell;
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
  gridTemplateColumns,
  // Optional: per-row --detail-color (tints .detail-cell.country's ratio
  // bar — see styles.css). Left unset, rows just inherit whatever
  // --detail-color the panel around the table already has — the group
  // table's one shared group color, unchanged from before this existed.
  // The chart table passes each row its own item's line color instead,
  // since a row there can represent any of several differently-colored
  // countries or categories, not one shared group.
  colorFor,
  ratioValue,
  ratioBarMode = "cell",
}) {
  if (gridTemplateColumns) {
    headerEl.style.gridTemplateColumns = gridTemplateColumns;
  } else {
    headerEl.style.removeProperty("grid-template-columns");
  }
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

  const sorted = sortDetailCountries(countries, columns, sort);
  const rows = buildDetailRows(sorted, columns, { ratioValue }).map(
    (detailRow, index) => {
      const row = document.createElement("div");
      row.dataset.rowIndex = String(index);
      row.className = "detail-row";
      if (gridTemplateColumns) {
        row.style.gridTemplateColumns = gridTemplateColumns;
      }
      if (colorFor) {
        const color = colorFor(detailRow.country);
        if (color) row.style.setProperty("--detail-color", color);
      }
      row.append(
        ...detailRow.cells.map((cell) =>
          createDetailCell(cell.text, cell.className, {
            ratio:
              ratioBarMode === "cell" && cell.key === "name"
                ? detailRow.ratio
                : null,
          }),
        ),
      );
      return row;
    },
  );
  rowsEl.onclick = (event) => {
    const row = event.target.closest("[data-row-index]");
    if (!row || !rowsEl.contains(row)) return;
    const detailRow = sorted[Number(row.dataset.rowIndex)];
    if (detailRow) onRowClick(detailRow);
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
