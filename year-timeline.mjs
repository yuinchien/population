// A secondary, vertical year-select control: one dash per year, evenly
// spaced by index (not by any data-driven scale), with the selected year
// picked out and a "magnify" preview under the cursor. Self-mounting — it
// creates and inserts its own root element (position: fixed, so where in
// the document it lands doesn't matter), so callers don't need any
// placeholder markup in index.html.

// Magnify falls off continuously (Gaussian, by tick *count* rather than
// pixel distance) instead of a hard cutoff — every tick gets some scale,
// even if negligible far from the cursor, so there's no visible "seam"
// where the effect stops. MAGNIFY_COUNT is the falloff's characteristic
// width in ticks (like a standard deviation): roughly the closest ~2 ticks
// either side read as clearly magnified, and it tapers out smoothly well
// beyond that.
const MAGNIFY_COUNT = 2;
const MAGNIFY_STRENGTH = 1.4; // extra scale at the epicenter
// Like a macOS dock: magnified ticks also need room to grow into. Rather
// than nudging only the immediate neighbors, each tick's offset is the
// *cumulative* sum of every more-central tick's excess size between it and
// the epicenter — so the "push" ripples all the way to both ends of the
// timeline, just tapering to a near-constant residual once the magnify
// falloff itself has decayed to ~0, instead of resetting sharply to 0 at
// some fixed radius (which is what left a visible seam before).
const MAGNIFY_SPACING = 4; // px of push per tick at full falloff

// Ticks are laid out at even fractions of the timeline's height, indexed by
// position rather than by year value — shared by build() (as a `top: %`
// string) and updateHover() (as a pixel offset for cursor hit-testing),
// which both need to agree on exactly the same mapping or hover would
// target the wrong tick.
function tickPositionRatio(i, n) {
  return i / (n - 1);
}

// onSelectYear(year, { commit }) reports the year under the cursor as the
// control is dragged — commit is false for live preview and true once the
// drag ends, mirroring the horizontal slider's input/change split. Applying
// that year (driving the rest of the app) is the caller's responsibility;
// this component only knows about its own ticks and cursor position.
// onDragStart, if given, fires once when a drag begins (e.g. to stop a
// milestone tour that might otherwise fight the user's own scrubbing).
export function createYearTimeline({ onSelectYear, onDragStart } = {}) {
  const root = document.createElement("div");
  root.id = "yearTimeline";
  root.className = "year-timeline";
  root.hidden = true;
  document.body.appendChild(root);

  let years = [];
  let tickElements = [];
  let dragging = false;

  function build(yearsData, milestoneYears = new Set()) {
    years = yearsData;
    const n = years.length;
    tickElements = years.map((year, i) => {
      const tick = document.createElement("div");
      tick.className = "year-tick";
      tick.classList.toggle("milestone", milestoneYears.has(year));
      tick.style.top = `${tickPositionRatio(i, n) * 100}%`;
      tick.dataset.year = year;

      const dash = document.createElement("span");
      dash.className = "year-tick-dash";
      const label = document.createElement("span");
      label.className = "year-tick-label";
      label.textContent = year;
      tick.append(dash, label);
      return tick;
    });
    root.replaceChildren(...tickElements);
    root.hidden = false;
  }

  function setSelectedYear(year) {
    tickElements.forEach((tick) => {
      tick.classList.toggle("selected", Number(tick.dataset.year) === year);
    });
  }

  // Reads tick positions analytically (index / count, matching how they
  // were laid out in build()) instead of calling getBoundingClientRect() per
  // tick, so a mousemove handler touching all ~150 ticks stays a plain
  // arithmetic loop rather than 150 forced layout reads.
  function updateHover(clientY) {
    const rect = root.getBoundingClientRect();
    const n = tickElements.length;
    let closestIndex = -1;
    let closestDistance = Infinity;
    tickElements.forEach((tick, i) => {
      const tickY = rect.top + tickPositionRatio(i, n) * rect.height;
      const distance = Math.abs(clientY - tickY);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = i;
      }
    });

    // Gaussian falloff computed for every tick (no cutoff) — "extra" is how
    // much bigger than baseline each tick is right now, in px, which is also
    // exactly how much room it needs pushed open around it.
    const sigma = MAGNIFY_COUNT;
    const extra = tickElements.map((_, i) => {
      const d = i - closestIndex;
      const falloff = Math.exp(-(d * d) / (2 * sigma * sigma));
      return MAGNIFY_STRENGTH ** 2 * falloff * MAGNIFY_SPACING;
    });

    // Ripple the offset outward from the epicenter: each step away
    // accumulates half of the extra space of both the tick just crossed and
    // the one being entered, so the push is continuous rather than jumping
    // in per-tick increments. The running sum naturally flattens out once
    // `extra` has decayed near 0, instead of hard-stopping at a fixed
    // radius.
    const offset = new Array(n).fill(0);
    for (let i = closestIndex - 1; i >= 0; i--) {
      offset[i] = offset[i + 1] - (extra[i] + extra[i + 1]) / 2;
    }
    for (let i = closestIndex + 1; i < n; i++) {
      offset[i] = offset[i - 1] + (extra[i] + extra[i - 1]) / 2;
    }

    tickElements.forEach((tick, i) => {
      const scale = 1 + extra[i] / MAGNIFY_SPACING;
      tick.style.setProperty("--magnify", scale.toFixed(3));
      tick.style.setProperty("--offset", `${offset[i].toFixed(2)}px`);
      tick.classList.toggle("hovered", i === closestIndex);
    });
  }

  function clearHover() {
    tickElements.forEach((tick) => {
      tick.style.removeProperty("--magnify");
      tick.style.removeProperty("--offset");
      tick.classList.remove("hovered");
    });
  }

  function yearFromClientY(clientY) {
    const rect = root.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    const index = Math.round(pct * (years.length - 1));
    return years[index];
  }

  function reportYearFromClientY(clientY, { commit }) {
    onSelectYear?.(yearFromClientY(clientY), { commit });
  }

  root.addEventListener("mousemove", (event) => {
    updateHover(event.clientY);
  });
  root.addEventListener("mouseleave", () => {
    if (!dragging) clearHover();
  });
  root.addEventListener("mousedown", (event) => {
    onDragStart?.();
    dragging = true;
    reportYearFromClientY(event.clientY, { commit: false });
  });
  window.addEventListener("mousemove", (event) => {
    if (!dragging) return;
    reportYearFromClientY(event.clientY, { commit: false });
    updateHover(event.clientY);
  });
  window.addEventListener("mouseup", (event) => {
    if (!dragging) return;
    dragging = false;
    reportYearFromClientY(event.clientY, { commit: true });
  });

  return { build, setSelectedYear };
}
