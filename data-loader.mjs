import { computeGlobalTrendMilestones } from "./status-insights.mjs";

export const DATA_URLS = {
  dots: "./data/population-dots.json",
  globalMetrics: "./data/population-global.json",
  incomeGroups: "./data/country-income-groups.json",
  countryDemographics: "./data/country-demographic-metrics.json",
};

export const ISO3_TO_ISO2 = {
    AFG: "AF",
    ALB: "AL",
    DZA: "DZ",
    ASM: "AS",
    AND: "AD",
    AGO: "AO",
    AIA: "AI",
    ATA: "AQ",
    ATG: "AG",
    ARG: "AR",
    ARM: "AM",
    ABW: "AW",
    AUS: "AU",
    AUT: "AT",
    AZE: "AZ",
    BHS: "BS",
    BHR: "BH",
    BGD: "BD",
    BRB: "BB",
    BLR: "BY",
    BEL: "BE",
    BLZ: "BZ",
    BEN: "BJ",
    BMU: "BM",
    BTN: "BT",
    BOL: "BO",
    BES: "BQ",
    BIH: "BA",
    BWA: "BW",
    BVT: "BV",
    BRA: "BR",
    IOT: "IO",
    BRN: "BN",
    BGR: "BG",
    BFA: "BF",
    BDI: "BI",
    CPV: "CV",
    KHM: "KH",
    CMR: "CM",
    CAN: "CA",
    CYM: "KY",
    CAF: "CF",
    TCD: "TD",
    CHL: "CL",
    CHN: "CN",
    CXR: "CX",
    CCK: "CC",
    COL: "CO",
    COM: "KM",
    COG: "CG",
    COD: "CD",
    COK: "CK",
    CRI: "CR",
    CIV: "CI",
    HRV: "HR",
    CUB: "CU",
    CUW: "CW",
    CYP: "CY",
    CZE: "CZ",
    DNK: "DK",
    DJI: "DJ",
    DMA: "DM",
    DOM: "DO",
    ECU: "EC",
    EGY: "EG",
    SLV: "SV",
    GNQ: "GQ",
    ERI: "ER",
    EST: "EE",
    SWZ: "SZ",
    ETH: "ET",
    FLK: "FK",
    FRO: "FO",
    FJI: "FJ",
    FIN: "FI",
    FRA: "FR",
    GUF: "GF",
    PYF: "PF",
    ATF: "TF",
    GAB: "GA",
    GMB: "GM",
    GEO: "GE",
    DEU: "DE",
    GHA: "GH",
    GIB: "GI",
    GRC: "GR",
    GRL: "GL",
    GRD: "GD",
    GLP: "GP",
    GUM: "GU",
    GTM: "GT",
    GGY: "GG",
    GIN: "GN",
    GNB: "GW",
    GUY: "GY",
    HTI: "HT",
    HMD: "HM",
    VAT: "VA",
    HND: "HN",
    HKG: "HK",
    HUN: "HU",
    ISL: "IS",
    IND: "IN",
    IDN: "ID",
    IRN: "IR",
    IRQ: "IQ",
    IRL: "IE",
    IMN: "IM",
    ISR: "IL",
    ITA: "IT",
    JAM: "JM",
    JPN: "JP",
    JEY: "JE",
    JOR: "JO",
    KAZ: "KZ",
    KEN: "KE",
    KIR: "KI",
    PRK: "KP",
    KOR: "KR",
    KWT: "KW",
    KGZ: "KG",
    LAO: "LA",
    LVA: "LV",
    LBN: "LB",
    LSO: "LS",
    LBR: "LR",
    LBY: "LY",
    LIE: "LI",
    LTU: "LT",
    LUX: "LU",
    MAC: "MO",
    MKD: "MK",
    MDG: "MG",
    MWI: "MW",
    MYS: "MY",
    MDV: "MV",
    MLI: "ML",
    MLT: "MT",
    MHL: "MH",
    MTQ: "MQ",
    MRT: "MR",
    MUS: "MU",
    MYT: "YT",
    MEX: "MX",
    FSM: "FM",
    MDA: "MD",
    MCO: "MC",
    MNG: "MN",
    MNE: "ME",
    MSR: "MS",
    MAR: "MA",
    MOZ: "MZ",
    MMR: "MM",
    NAM: "NA",
    NRU: "NR",
    NPL: "NP",
    NLD: "NL",
    NCL: "NC",
    NZL: "NZ",
    NIC: "NI",
    NER: "NE",
    NGA: "NG",
    NIU: "NU",
    NFK: "NF",
    MNP: "MP",
    NOR: "NO",
    OMN: "OM",
    PAK: "PK",
    PLW: "PW",
    PSE: "PS",
    PAN: "PA",
    PNG: "PG",
    PRY: "PY",
    PER: "PR",
    PHL: "PH",
    PCN: "PN",
    POL: "PL",
    PRT: "PT",
    PRI: "PR",
    QAT: "QA",
    REU: "RE",
    ROU: "RO",
    RUS: "RU",
    RWA: "RW",
    BLM: "BL",
    SHN: "SH",
    KNA: "KN",
    LCA: "LC",
    MAF: "MF",
    SPM: "PM",
    VCT: "VC",
    WSM: "WS",
    SMR: "SM",
    STP: "ST",
    SAU: "SA",
    SEN: "SN",
    SRB: "RS",
    SYC: "SC",
    SLE: "SL",
    SGP: "SG",
    SXM: "SX",
    SVK: "SK",
    SVN: "SI",
    SLB: "SB",
    SOM: "SO",
    ZAF: "ZA",
    SGS: "GS",
    SSD: "SS",
    ESP: "ES",
    LKA: "LK",
    SDN: "SD",
    SUR: "SR",
    SJM: "SJ",
    SWE: "SE",
    CHE: "CH",
    SYR: "SY",
    TWN: "TW",
    TJK: "TJ",
    TZA: "TZ",
    THA: "TH",
    TLS: "TL",
    TGO: "TG",
    TKL: "TK",
    TON: "TO",
    TTO: "TT",
    TUN: "TN",
    TUR: "TR",
    TKM: "TM",
    TCA: "TC",
    TUV: "TV",
    UGA: "UG",
    UKR: "UA",
    ARE: "AE",
    GBR: "GB",
    UMI: "UM",
    USA: "US",
    URY: "UY",
    UZB: "UZ",
    VUT: "VU",
    VEN: "VE",
    VNM: "VN",
    VGB: "VG",
    VIR: "VI",
    WLF: "WF",
    ESH: "EH",
    YEM: "YE",
    ZMB: "ZM",
    ZWE: "ZW",
  };

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

// data/population-global.json holds one series per indicator, each an
// array of {year, value} rows; index by year so applyYear() can look up
// all five in O(1) as the slider moves. "variants" (High/Low UN scenarios)
// is a nested object, not a flat series, so it's excluded here and indexed
// separately by buildVariantIndex().
export function buildGlobalMetricsIndex(globalData) {
  const byYear = new Map();
  Object.entries(globalData).forEach(([series, rows]) => {
    if (series === "variants") return;
    rows.forEach(({ year, value }) => {
      if (!byYear.has(year)) byYear.set(year, {});
      byYear.get(year)[series] = value;
    });
  });
  return byYear;
}

// Same shape as buildGlobalMetricsIndex, but for a single variant's series
// object (globalData.variants.high or .low).
export function buildVariantIndex(variantSeries = {}) {
  const byYear = new Map();
  Object.entries(variantSeries).forEach(([series, rows]) => {
    rows.forEach(({ year, value }) => {
      if (!byYear.has(year)) byYear.set(year, {});
      byYear.get(year)[series] = value;
    });
  });
  return byYear;
}

// The year a country's modeled population is highest — i.e. where it
// crests and starts declining. Boundary years are excluded: a max at either
// edge usually just means "still rising/falling when the data runs out,"
// not a genuine peak.
export function computePeakYear(populations, years) {
  let maxIndex = -1;
  let maxValue = -Infinity;
  for (let i = 0; i < populations.length; i++) {
    const value = populations[i];
    if (value != null && value > maxValue) {
      maxValue = value;
      maxIndex = i;
    }
  }
  if (maxIndex <= 0 || maxIndex >= populations.length - 1) return null;
  return years[maxIndex];
}

export async function loadPopulationData({
  urls = DATA_URLS,
  fetchImpl = fetch,
} = {}) {
  // country-demographic-metrics.json is the single biggest payload here
  // (bigger than the other three combined) but nothing on first paint reads
  // it — only a country/group detail view or a chart tab that needs one of
  // its metrics does. Fired off immediately so it's not sitting idle, but
  // deliberately left out of the Promise.all below so the initial globe/map
  // render isn't blocked waiting on it; callers get it back as its own
  // promise and can pick it up once it resolves.
  const countryDemographicMetricsPromise = fetchJson(
    urls.countryDemographics,
    fetchImpl,
  );

  const [dotsData, globalData, incomeGroups] = await Promise.all([
    fetchJson(urls.dots, fetchImpl),
    fetchJson(urls.globalMetrics, fetchImpl),
    fetchJson(urls.incomeGroups, fetchImpl),
  ]);

  const countries = dotsData.countries.map((country) => ({
    ...country,
    peakYear: computePeakYear(country.populations, dotsData.years),
  }));
  const years = dotsData.years;
  const historicalCutoffYear = dotsData.historicalCutoffYear ?? Infinity;
  const globalMetricsByYear = buildGlobalMetricsIndex(globalData);
  const globalTrendMilestones = computeGlobalTrendMilestones(
    globalData,
    countries,
    years,
    historicalCutoffYear,
  );
  const highMetricsByYear = globalData.variants?.high
    ? buildVariantIndex(globalData.variants.high)
    : new Map();
  const lowMetricsByYear = globalData.variants?.low
    ? buildVariantIndex(globalData.variants.low)
    : new Map();

  return {
    countries,
    years,
    incomeGroups,
    countryDemographicMetricsPromise,
    historicalCutoffYear,
    globalMetricsByYear,
    globalTrendMilestones,
    highMetricsByYear,
    lowMetricsByYear,
  };
}
