import { createDetailPanelHeader } from "./detail-panel-header.mjs";

export function getAppElements(root = document) {
  // The group-detail panel and the country-detail panel are visually
  // identical headers but must never share ids — built fresh here instead
  // of hardcoded twice in index.html. See detail-panel-header.mjs.
  const detailPanel = root.querySelector("#detailPanel");
  const countryPanel = root.querySelector("#countryPanel");
  // detailPanel's header lives in its right-column wrapper (alongside
  // .detail-table), not the panel itself — #detailNav is the left column
  // and spans the panel's full height, not just the space below the header.
  const detailPanelMain = detailPanel?.querySelector(".detail-panel-main");
  const detailPanelHeader = detailPanelMain
    ? createDetailPanelHeader(detailPanelMain)
    : {};
  const countryPanelHeader = countryPanel
    ? createDetailPanelHeader(countryPanel)
    : {};

  return {
    mobileStorySheet: root.querySelector("#mobileStorySheet"),
    mobileStoryHandle: root.querySelector("#mobileStoryHandle"),
    chartDetailTable: root.querySelector("#chartDetailTable"),
    chartDetailTableDesktop: root.querySelector("#chartDetailTableDesktop"),
    chartDetailTableMobile: root.querySelector("#chartDetailTableMobile"),
    menuToggle: root.querySelector("#menuToggle"),
    menuShim: root.querySelector("#menuShim"),
    infoButton: root.querySelector("#infoButton"),
    infoPanel: root.querySelector("#infoPanel"),
    infoClose: root.querySelector("#infoClose"),
    themeToggle: root.querySelector("#themeToggle"),
    themeToggleLight: root.querySelector("#themeToggleLight"),
    milestoneTour: root.querySelector("#milestoneTour"),
    milestoneTourIcon: root.querySelector("#milestoneTourIcon"),
    clusterPlay: root.querySelector("#clusterPlay"),
    clusterPlayIcon: root.querySelector("#clusterPlayIcon"),
    milestonePrev: root.querySelector("#milestonePrev"),
    milestoneNext: root.querySelector("#milestoneNext"),
    milestoneCaption: root.querySelector("#milestoneCaption"),
    milestoneProgressFill: root.querySelector("#milestoneProgressFill"),
    exploreMilestones: root.querySelector("#exploreMilestones"),
    status: root.querySelector("#status"),
    headerTitle: root.querySelector("#headerTitle"),
    projectionScenarioLabel: root.querySelector("#projectionScenarioLabel"),
    tooltip: root.querySelector("#tooltip"),
    chartTooltip: root.querySelector("#chartTooltip"),
    clusterArchetypeTooltip: root.querySelector("#clusterArchetypeTooltip"),
    yearSlider: root.querySelector("#yearSlider"),
    yearValue: root.querySelector("#yearValue"),
    colorMode: root.querySelector("#colorMode"),
    legend: root.querySelector("#legend"),
    viewMode: root.querySelector("#viewMode"),
    buttonsContainer: root.querySelector("#buttonsContainer"),
    calloutLayer: root.querySelector("#calloutLayer"),
    mapPanHint: root.querySelector("#mapPanHint"),
    mapResetView: root.querySelector("#mapResetView"),
    detailPanel,
    detailFlag: detailPanelHeader.flag,
    detailTitle: detailPanelHeader.title,
    detailSubtitle: detailPanelHeader.subtitle,
    detailClose: detailPanelHeader.closeButton,
    detailNav: root.querySelector("#detailNav"),
    detailHeader: root.querySelector("#detailHeader"),
    detailRows: root.querySelector("#detailRows"),
    countryPanel,
    countryFlag: countryPanelHeader.flag,
    countryTitle: countryPanelHeader.title,
    countrySubtitle: countryPanelHeader.subtitle,
    countryClose: countryPanelHeader.closeButton,
    countryDetail: root.querySelector("#countryDetail"),
    countryChart: root.querySelector("#countryChart"),
    countryChartValue: root.querySelector("#countryChartValue"),
    countrySparklines: root.querySelector("#countrySparklines"),
    countryPyramidCard: root.querySelector("#countryPyramidCard"),
    countryPyramidStage: root.querySelector("#countryPyramidStage"),
    countryPyramid: root.querySelector("#countryPyramid"),
    countrySimilar: root.querySelector("#countrySimilar"),
    countrySimilarList: root.querySelector("#countrySimilarList"),
    chartPanel: root.querySelector("#chartPanel"),
    chartMetricTabs: root.querySelector("#chartMetricTabs"),
    trendChart: root.querySelector("#trendChart"),
    radarChart: root.querySelector("#radarChart"),
    chartCountryPicker: root.querySelector("#chartCountryPicker"),
    chartCountryPickerSummary: root.querySelector("#chartCountryPickerSummary"),
    chartCountryPickerSummaryFlags: root.querySelector(
      "#chartCountryPickerSummaryFlags",
    ),
    chartCountryPickerCancel: root.querySelector("#chartCountryPickerCancel"),
    chartProjectionScenario: root.querySelector("#chartProjectionScenario"),
    chartCountryChips: root.querySelector("#chartCountryChips"),
    chartCountrySearch: root.querySelector("#chartCountrySearch"),
    chartCountrySuggestions: root.querySelector("#chartCountrySuggestions"),
    chartTableHeader: root.querySelector("#chartTableHeader"),
    chartTableRows: root.querySelector("#chartTableRows"),
    clusterView: root.querySelector("#clusterView"),
    clusterCanvas: root.querySelector("#clusterCanvas"),
    searchBar: root.querySelector("#searchBar"),
    searchCountryPicker: root.querySelector("#searchCountryPicker"),
    searchCountryChips: root.querySelector("#searchCountryChips"),
    searchCountryInput: root.querySelector("#searchCountryInput"),
    searchCountrySuggestions: root.querySelector("#searchCountrySuggestions"),
    searchView: root.querySelector("#searchView"),
    searchCountryGrid: root.querySelector("#searchCountryGrid"),
    searchCategoryGrid: root.querySelector("#searchCategoryGrid"),
    countrySummary: root.querySelector("#countrySummary"),
    lifetimeView: root.querySelector("#lifetimeView"),
    lifetimeClose: root.querySelector("#lifetimeClose"),
    lifetimeForm: root.querySelector("#lifetimeForm"),
    lifetimeBirthYear: root.querySelector("#lifetimeBirthYear"),
    lifetimeBirthYearError: root.querySelector("#lifetimeBirthYearError"),
    lifetimeCountry: root.querySelector("#lifetimeCountry"),
    lifetimeCountrySuggestions: root.querySelector("#lifetimeCountrySuggestions"),
    lifetimeStory: root.querySelector("#lifetimeStory"),
    lifetimeAbout: root.querySelector("#lifetimeAbout"),
    lifetimeJourney: root.querySelector("#lifetimeJourney"),
    lifetimeButtonBegin: root.querySelector("#lifetimeButtonBegin"),
  };
}

function missingElements(elements, keys) {
  return keys.filter((key) => !elements[key]);
}

export function assertElements(elements, keys, label = "app") {
  const missing = missingElements(elements, keys);
  if (!missing.length) return;
  throw new Error(
    `Missing required ${label} element${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
  );
}
