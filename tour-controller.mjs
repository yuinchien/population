export function adjacentMilestoneYears(years, year) {
  const index = years.indexOf(year);
  if (index !== -1) {
    return {
      prev: index > 0 ? years[index - 1] : null,
      next: index < years.length - 1 ? years[index + 1] : null,
    };
  }
  let prev = null;
  let next = null;
  for (const candidate of years) {
    if (candidate < year) prev = candidate;
    else if (candidate > year && next === null) next = candidate;
  }
  return { prev, next };
}

export function createTourController({
  getMilestoneYears,
  getCurrentYear,
  goToYear,
  onPlayingChange = () => {},
  onProgressReset = () => {},
  onProgressStart = () => {},
  durationMs = 6000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null;

  function isPlaying() {
    return timer !== null;
  }

  function stop() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
    onPlayingChange(false);
    onProgressReset();
  }

  function scheduleNext() {
    onProgressStart(durationMs);
    timer = setTimer(() => {
      const years = getMilestoneYears();
      const index = years.indexOf(getCurrentYear());
      if (index === -1 || !years.length) {
        stop();
        return;
      }
      goToYear(years[(index + 1) % years.length]);
      scheduleNext();
    }, durationMs);
  }

  function start() {
    if (isPlaying()) return;
    const years = getMilestoneYears();
    if (!years.length) return;
    if (!years.includes(getCurrentYear())) goToYear(years[0]);
    onPlayingChange(true);
    scheduleNext();
  }

  function toggle() {
    if (isPlaying()) stop();
    else start();
  }

  return { isPlaying, start, stop, toggle };
}
