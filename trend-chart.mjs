export const TREND_CHART_PADDING = {
  top: 16,
  right: 32,
  bottom: 24,
  left: 48,
};

export function separateTrendLineLabels(labels, minimumGap = 13) {
  const positioned = labels
    .map((label) => ({ ...label }))
    .sort((a, b) => a.y - b.y);
  for (let index = 1; index < positioned.length; index++) {
    const previous = positioned[index - 1];
    if (positioned[index].y - previous.y < minimumGap) {
      positioned[index].y = previous.y + minimumGap;
    }
  }
  return positioned;
}
