// Builds a fresh `.detail-panel-header` (flag / title / subtitle / close
// button) and inserts it as the first child of `container`. The group-detail
// panel and the country-detail panel are visually identical here but must
// never share DOM ids — building each one in JS instead of hardcoding two
// copies in index.html sidesteps that entirely.
export function createDetailPanelHeader(container) {
  const header = document.createElement("div");
  header.className = "detail-panel-header";

  const titleRow = document.createElement("div");
  titleRow.className = "detail-title-row";

  const flag = document.createElement("span");
  flag.className = "country-summary-flag";
  flag.setAttribute("aria-hidden", "true");
  flag.hidden = true;

  const title = document.createElement("h2");
  const subtitle = document.createElement("p");
  subtitle.className = "detail-subtitle";
  titleRow.append(flag, title, subtitle);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "detail-close";
  closeButton.setAttribute("aria-label", "Close detail panel");
  closeButton.title = "Close";
  const closeIcon = document.createElement("span");
  closeIcon.className = "material-symbols-outlined";
  closeIcon.textContent = "close";
  closeButton.append(closeIcon);

  header.append(titleRow, closeButton);
  container.prepend(header);

  return { flag, title, subtitle, closeButton };
}
