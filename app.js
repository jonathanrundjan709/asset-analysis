// ============================================
// ASSET & PLACEMENT ANALYSIS - MAIN ENGINE
// Updated: exclude inactive / zero-activity rows from analysis
// ============================================

"use strict";

// ============================================
// STATE
// ============================================
const APP = {
  files: [],          // { id, name, platform, week, rawText, headers, rows, dateRange }
  googleRows: [],     // normalized + aggregated Google Ads rows
  metaRows: [],       // normalized + aggregated Meta Ads rows
  inactiveRows: [],   // rows excluded from main analysis because no meaningful activity
  guardrails: {
    meta: { Instagram: 59, Facebook: 49 },
    google: []        // [{ id, campaign, search, gdn, youtube }]
  },
  actionMetricGuardrails: {
    google: { ctr: 0, clickToInstall: 0 },
    meta: { ctr: 0, clickToInstall: 0 }
  },
  metricFilters: {
    google: {},
    meta: {}
  },
  hideMetrics: {
    google: false,
    meta: false,
    placement: false
  },
  wowFlagRules: {
    ctrDrop: 0.2,
    c2iDrop: 0.2,
    cpiIncrease: 0.2,
    costUpInstallsDown: true,
    stoppedInstalls: true,
    newInstalls: true
  }
};

const NO_METRIC_VALUES_SELECTED = "__no_metric_values_selected__";

// ============================================
// INIT
// ============================================
document.addEventListener("DOMContentLoaded", () => {
  wireNavTabs();
  wireUpload();
  wireGuardrails();
  wireActionMetricGuardrails();
  wireWoWFlagRules();
  wireHideMetrics();
  wireExport();
});

function wireNavTabs() {
  document.querySelectorAll(".nav-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));

      btn.classList.add("active");
      const target = document.getElementById("tab-" + btn.dataset.tab);
      if (target) target.classList.add("active");
    });
  });
}

function wireActionMetricGuardrails() {
  document.querySelectorAll("[data-action-guardrail]").forEach(input => {
    input.addEventListener("change", e => {
      const [platform, metric] = e.target.dataset.actionGuardrail.split(".");
      if (!APP.actionMetricGuardrails[platform]) APP.actionMetricGuardrails[platform] = {};
      APP.actionMetricGuardrails[platform][metric] = (Number(e.target.value) || 0) / 100;
      runAnalysis();
    });
  });
}

function wireWoWFlagRules() {
  document.querySelectorAll("[data-wow-rule]").forEach(input => {
    input.addEventListener("change", e => {
      const key = e.target.dataset.wowRule;
      APP.wowFlagRules[key] = input.type === "checkbox"
        ? input.checked
        : (Number(input.value) || 0) / 100;
      runAnalysis();
    });
  });
}

function wireHideMetrics() {
  document.querySelectorAll("[data-hide-metrics]").forEach(input => {
    input.addEventListener("change", e => {
      APP.hideMetrics[e.target.dataset.hideMetrics] = e.target.checked;
      renderAllTabs();
    });
  });
}

function wireUpload() {
  const zone = document.getElementById("uploadZone");
  const input = document.getElementById("fileInput");
  const btnSample = document.getElementById("btnLoadSample");
  const btnClear = document.getElementById("btnClearAll");

  if (!zone || !input) return;

  zone.addEventListener("click", () => input.click());
  zone.addEventListener("dragover", e => {
    e.preventDefault();
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", e => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    handleFiles(e.dataTransfer.files);
  });

  input.addEventListener("change", () => {
    handleFiles(input.files);
    input.value = "";
  });

  if (btnSample) btnSample.addEventListener("click", loadSampleData);
  if (btnClear) btnClear.addEventListener("click", clearAll);
}

function wireGuardrails() {
  const btnAdd = document.getElementById("btnAddGuardrail");
  const ig = document.getElementById("metaIgGuardrail");
  const fb = document.getElementById("metaFbGuardrail");

  if (btnAdd) btnAdd.addEventListener("click", addGuardrailCampaign);

  if (ig) {
    ig.addEventListener("change", e => {
      APP.guardrails.meta.Instagram = Number(e.target.value) || 0;
      runAnalysis();
    });
  }

  if (fb) {
    fb.addEventListener("change", e => {
      APP.guardrails.meta.Facebook = Number(e.target.value) || 0;
      runAnalysis();
    });
  }
}

function wireExport() {
  document.querySelectorAll(".export-btn").forEach(btn => {
    btn.addEventListener("click", () => handleExport(btn.dataset.export));
  });
}

// ============================================
// FILE HANDLING
// ============================================
async function handleFiles(fileList) {
  for (const file of fileList) {
    let parsedFile = null;

    try {
      parsedFile = await parseUploadedFile(file);
    } catch (err) {
      console.error(`Failed to parse ${file.name}`, err);
      alert(`Could not read ${file.name}. ${err.message || "Please check the file format."}`);
      continue;
    }

    if (!parsedFile || !parsedFile.parsed) continue;

    const { rawText, parsed } = parsedFile;

    const platform = detectPlatform(parsed.headers, rawText);
    const dateRange = detectDateRange(rawText, file.name);

    APP.files.push({
      id: crypto.randomUUID(),
      name: file.name,
      platform,
      week: "auto",
      rawText,
      headers: parsed.headers,
      rows: parsed.rows,
      dateRange,
      campaignOverride: "",
      adGroupOverride: ""
    });
  }

  renderFilesList();
  runAnalysis();
}

async function parseUploadedFile(file) {
  const rawText = await readUploadedText(file);
  const parsed = parseCSVSmart(rawText);

  if (!parsed || !parsed.headers.length) {
    throw new Error("No readable CSV header found.");
  }

  return {
    rawText,
    parsed
  };
}

function clearAll() {
  APP.files = [];
  APP.googleRows = [];
  APP.metaRows = [];
  APP.inactiveRows = [];
  APP.googleBenchmarks = {};
  APP.metaBenchmarks = {};
  APP.placementGoogle = [];
  APP.placementMeta = [];
  APP.wowResults = [];
  APP.metricFilters = { google: {}, meta: {} };
  APP.hideMetrics = { google: false, meta: false, placement: false };
  APP.actionMetricGuardrails = {
    google: { ctr: 0, clickToInstall: 0 },
    meta: { ctr: 0, clickToInstall: 0 }
  };
  APP.wowFlagRules = {
    ctrDrop: 0.2,
    c2iDrop: 0.2,
    cpiIncrease: 0.2,
    costUpInstallsDown: true,
    stoppedInstalls: true,
    newInstalls: true
  };
  document.querySelectorAll("[data-hide-metrics]").forEach(input => { input.checked = false; });
  document.querySelectorAll("[data-action-guardrail]").forEach(input => { input.value = 0; });
  document.querySelectorAll("[data-wow-rule]").forEach(input => {
    if (input.type === "checkbox") input.checked = true;
    else input.value = 20;
  });

  renderFilesList();
  renderAllTabs();
  updateStats();
}

async function readUploadedText(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return decodeUtf16(bytes, true);
    }

    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return decodeUtf16(bytes, false);
    }
  }

  const sample = bytes.slice(0, Math.min(bytes.length, 1000));
  const nullCount = sample.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0);

  if (nullCount > sample.length * 0.2) {
    const oddNulls = sample.filter((byte, i) => i % 2 === 1 && byte === 0).length;
    const evenNulls = sample.filter((byte, i) => i % 2 === 0 && byte === 0).length;
    return decodeUtf16(bytes, oddNulls >= evenNulls);
  }

  return new TextDecoder("utf-8").decode(bytes);
}

function decodeUtf16(bytes, littleEndian) {
  const label = littleEndian ? "utf-16le" : "utf-16be";

  try {
    return new TextDecoder(label).decode(bytes);
  } catch (_) {
    return decodeUtf16Manually(bytes, littleEndian);
  }
}

function decodeUtf16Manually(bytes, littleEndian) {
  const chars = [];
  let start = 0;

  if (bytes.length >= 2) {
    const hasBom = littleEndian
      ? bytes[0] === 0xff && bytes[1] === 0xfe
      : bytes[0] === 0xfe && bytes[1] === 0xff;
    if (hasBom) start = 2;
  }

  for (let i = start; i + 1 < bytes.length; i += 2) {
    const code = littleEndian
      ? bytes[i] | (bytes[i + 1] << 8)
      : (bytes[i] << 8) | bytes[i + 1];
    chars.push(String.fromCharCode(code));
  }

  return chars.join("");
}

// ============================================
// CSV PARSER
// Handles Google Ads extra header rows
// ============================================
function parseCSVSmart(text) {
  text = normalizeDelimitedText(text);
  const allRows = parseCSVRaw(text);
  return parseRowsSmart(allRows);
}

function parseRowsSmart(allRows) {
  allRows = normalizeParsedRows(allRows);
  if (!allRows.length) return null;

  const googleIndicators = ["asset", "asset type", "clicks", "ctr", "impr", "cost", "install"];
  const metaIndicators = ["ad name", "impressions", "amount spent", "results", "ad set"];

  let headerIdx = 0;

  for (let i = 0; i < Math.min(allRows.length, 15); i++) {
    const rowLower = allRows[i].map(c => c.toLowerCase().trim());
    const matchGoogle = googleIndicators.filter(ind => rowLower.some(c => c.includes(ind))).length;
    const matchMeta = metaIndicators.filter(ind => rowLower.some(c => c.includes(ind))).length;

    if (matchGoogle >= 3 || matchMeta >= 3) {
      headerIdx = i;
      break;
    }
  }

  const headers = allRows[headerIdx].map(h => h.trim());
  const rows = allRows.slice(headerIdx + 1).filter(r => r.some(c => String(c || "").trim() !== ""));

  const filtered = rows.filter(r => {
    const joined = r.join(" ").toLowerCase().trim();
    if (!joined) return false;
    if (joined.startsWith("total:")) return false;
    if (joined === "total") return false;
    return true;
  });

  return { headers, rows: filtered };
}

function normalizeParsedRows(rows) {
  return rows
    .map(row => row.map(cell => normalizeCellText(cell)))
    .filter(row => row.some(cell => cell !== ""));
}

function normalizeCellText(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\u0000/g, "")
    .trim();
}

function scoreParsedHeaders(headers, rawText) {
  const lower = headers.map(h => h.toLowerCase());

  const googleIndicators = ["segmentation_info.ad_network", "asset type", "app asset type", "conv. rate", "ad network", "clicks", "ctr", "impr"];
  const metaIndicators = ["ad name", "ad delivery", "amount spent", "ad set name", "quality ranking", "results", "impressions"];

  const googleScore = googleIndicators.filter(ind => lower.some(h => h.includes(ind))).length;
  const metaScore = metaIndicators.filter(ind => lower.some(h => h.includes(ind))).length;
  const titleBoost = String(rawText || "").toLowerCase().includes("asset details report") ? 5 : 0;

  return Math.max(googleScore + titleBoost, metaScore);
}

function parseCSVRaw(text) {
  const rows = [];
  const delimiter = detectDelimiter(text);
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.length || row.length) {
    row.push(current);
    rows.push(row);
  }

  return rows.map(r => r.map(v => String(v || "").trim()));
}

function normalizeDelimitedText(text) {
  return String(text || "").replace(/\u0000/g, "");
}

function detectDelimiter(text) {
  const sampleLines = String(text || "")
    .split(/\r?\n/)
    .slice(0, 10)
    .filter(line => line.trim());

  const scores = [",", "\t", ";"].map(delimiter => ({
    delimiter,
    score: sampleLines.reduce((sum, line) => sum + countDelimiterOutsideQuotes(line, delimiter), 0)
  }));

  scores.sort((a, b) => b.score - a.score);
  return scores[0].score > 0 ? scores[0].delimiter : ",";
}

function countDelimiterOutsideQuotes(line, delimiter) {
  let count = 0;
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === "\"") {
      if (inQuotes && next === "\"") i++;
      else inQuotes = !inQuotes;
      continue;
    }

    if (ch === delimiter && !inQuotes) count++;
  }

  return count;
}

// ============================================
// PLATFORM DETECTION
// ============================================
function detectPlatform(headers, rawText) {
  const lower = headers.map(h => h.toLowerCase());

  const gIndicators = ["segmentation_info.ad_network", "asset type", "app asset type", "conv. rate", "ad network"];
  const mIndicators = ["ad name", "ad delivery", "amount spent", "ad set name", "quality ranking"];

  const gScore = gIndicators.filter(ind => lower.some(h => h.includes(ind))).length;
  const mScore = mIndicators.filter(ind => lower.some(h => h.includes(ind))).length;

  if (rawText.toLowerCase().includes("asset details report")) return "google";
  if (gScore > mScore) return "google";
  if (mScore > gScore) return "meta";
  if (lower.some(h => h.includes("asset"))) return "google";
  if (lower.some(h => h.includes("ad name"))) return "meta";

  return "unknown";
}

function detectDateRange(rawText, fileName) {
  const lines = rawText.split("\n").slice(0, 8);

  for (const line of lines) {
    const match = line.match(/(\w+ \d{1,2},?\s*\d{4})\s*[-–]\s*(\w+ \d{1,2},?\s*\d{4})/);
    if (match) return { start: match[1], end: match[2] };
  }

  const fnMatch = fileName.match(/(\d{4}[-_]\d{2}[-_]\d{2})/g);
  if (fnMatch && fnMatch.length >= 2) return { start: fnMatch[0], end: fnMatch[1] };
  if (fnMatch && fnMatch.length === 1) return { start: fnMatch[0], end: fnMatch[0] };

  return null;
}

// ============================================
// DATA CLEANING UTILITIES
// ============================================
function cleanNumber(val) {
  if (val === null || val === undefined || val === "") return 0;

  let s = String(val).trim();

  if (!s || s === "—" || s === "-" || s.toLowerCase() === "nan") return 0;

  s = s.replace(/[^\d.,%\-]/g, "");

  if (!s) return 0;

  if (s.includes("%")) {
    s = s.replace("%", "").replace(/,/g, "");
    return Number(s) / 100 || 0;
  }

  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(/,/g, "");
  }

  return Number(s) || 0;
}

function cleanNumberRaw(val) {
  if (val === null || val === undefined || val === "") return 0;

  let s = String(val).trim();
  if (!s || s === "—" || s === "-") return 0;

  s = s.replace(/[^\d.,%\-]/g, "");
  if (s.includes("%")) s = s.replace("%", "");

  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(/,/g, "");

  return Number(s) || 0;
}

function hasMeaningfulActivity({ cost = 0, impressions = 0, clicks = 0, installs = 0 }) {
  return Number(cost) > 0 || Number(impressions) > 0 || Number(clicks) > 0 || Number(installs) > 0;
}

function getCol(row, headers, patterns) {
  for (const pat of patterns) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(pat.toLowerCase()));
    if (idx >= 0 && row[idx] !== undefined) return row[idx];
  }
  return "";
}

function getColExact(row, headers, names) {
  for (const name of names) {
    const idx = headers.findIndex(h => h.toLowerCase().trim() === name.toLowerCase().trim());
    if (idx >= 0 && row[idx] !== undefined) return row[idx];
  }
  return "";
}

function getColByIndex(row, headers, colName, excludeCol) {
  const lowerName = colName.toLowerCase().trim();
  const lowerExclude = excludeCol.toLowerCase().trim();

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().trim();
    if (h === lowerName && h !== lowerExclude) return row[i] || "";
    if (h.includes(lowerName) && !h.includes(lowerExclude) && h !== lowerExclude) return row[i] || "";
  }

  return "";
}

function getDateCol(row, headers, exactNames, fuzzyNames = []) {
  const exact = getColExact(row, headers, exactNames);
  if (exact) return exact;

  for (const name of fuzzyNames) {
    const idx = headers.findIndex(h => normalizeHeaderName(h).includes(normalizeHeaderName(name)));
    if (idx >= 0 && row[idx] !== undefined) return row[idx];
  }

  return "";
}

function normalizeHeaderName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function detectRowPeriod(row, headers, file) {
  const startRaw = getDateCol(row, headers, [
    "reporting starts",
    "date_start",
    "start date",
    "week start",
    "segments.week",
    "segments.date",
    "day",
    "date",
    "week"
  ], [
    "reporting start",
    "date start",
    "start date",
    "week start",
    "segments week",
    "segments date"
  ]);

  const endRaw = getDateCol(row, headers, [
    "reporting ends",
    "date_stop",
    "end date",
    "week end"
  ], [
    "reporting end",
    "date stop",
    "end date",
    "week end"
  ]);

  const fallbackStart = file.dateRange ? file.dateRange.start : "";
  const fallbackEnd = file.dateRange ? file.dateRange.end : "";
  let start = parseDateFlexible(startRaw || fallbackStart);
  let end = parseDateFlexible(endRaw || fallbackEnd);

  if (startRaw && !endRaw && !fallbackEnd && start) {
    if (hasWeekDateHeader(headers)) {
      end = addDays(start, 6);
    } else if (hasDailyDateHeader(headers)) {
      start = startOfWeekMonday(start);
      end = addDays(start, 6);
    }
  }

  if (!end) end = parseDateFlexible(startRaw || fallbackStart);

  if (!start && !end) return null;

  const periodStart = start || end;
  const periodEnd = end || start;

  return {
    start: formatDateKey(periodStart),
    end: formatDateKey(periodEnd),
    sortTime: periodEnd.getTime()
  };
}

function hasDailyDateHeader(headers) {
  return headers.some(h => {
    const name = normalizeHeaderName(h);
    return name === "day" || name === "date" || name === "segments date";
  });
}

function hasWeekDateHeader(headers) {
  return headers.some(h => {
    const name = normalizeHeaderName(h);
    return name === "week" || name === "segments week" || name === "week start";
  });
}

function startOfWeekMonday(date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(result, diff);
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function parseDateFlexible(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/^"+|"+$/g, "")
    .replace(/_/g, "-")
    .replace(/\s+/g, " ");

  const iso = cleaned.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return makeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slashYmd = cleaned.match(/\b(\d{4})\/(\d{1,2})\/(\d{1,2})\b/);
  if (slashYmd) return makeDate(Number(slashYmd[1]), Number(slashYmd[2]), Number(slashYmd[3]));

  const dmy = cleaned.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (dmy) {
    const year = normalizeYear(Number(dmy[3]));
    const first = Number(dmy[1]);
    const second = Number(dmy[2]);
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    return makeDate(year, month, day);
  }

  const parsed = new Date(cleaned);
  if (!Number.isNaN(parsed.getTime())) {
    return makeDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }

  return null;
}

function normalizeYear(year) {
  return year < 100 ? 2000 + year : year;
}

function makeDate(year, month, day) {
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function safeDivide(num, den) {
  if (!den || den === 0) return 0;
  return num / den;
}

function median(arr) {
  const sorted = [...arr].filter(v => Number(v) > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;

  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ============================================
// GOOGLE ADS NORMALIZATION
// ============================================
function normalizeGoogleAds(file) {
  const { headers, rows } = file;
  const normalized = [];
  const inactive = [];

  for (const row of rows) {
    const channel = mapGoogleChannel(getCol(row, headers, [
      "segmentation_info.ad_network",
      "ad network",
      "network",
      "channel"
    ]));

    const campaign =
      getCol(row, headers, ["campaign"]) ||
      file.campaignOverride ||
      inferFromFilename(file.name, "campaign");

    const adGroup =
      getCol(row, headers, ["ad group", "adgroup"]) ||
      file.adGroupOverride ||
      inferFromFilename(file.name, "adgroup");

    const assetType =
      getColExact(row, headers, ["asset type", "app asset type"]) ||
      getCol(row, headers, ["asset type", "app asset type"]);

    const asset =
      getColExact(row, headers, ["asset", "app asset"]) ||
      getColByIndex(row, headers, "asset", "asset type");
    const assetUrl =
      extractAssetUrl(asset) ||
      extractAssetUrl(getColExact(row, headers, [
        "asset url",
        "image url",
        "youtube url",
        "youtube video url",
        "final url",
        "preview url",
        "video url"
      ]));

    const cost = cleanNumber(getCol(row, headers, ["cost"]));
    const impressions = cleanNumber(getCol(row, headers, ["impr.", "impr", "impressions"]));
    const clicks = cleanNumber(getCol(row, headers, ["clicks"]));
    const installs = cleanNumber(getCol(row, headers, ["installs", "install", "conv. (install)", "conversions"]));
    const period = detectRowPeriod(row, headers, file);

    const base = {
      platform: "google",
      channel: channel || "Unknown",
      campaign: campaign || "Unknown Campaign",
      adGroup: adGroup || "Unknown Ad Group",
      assetType: normalizeGoogleAssetType(assetType),
      asset: asset || "Unknown Asset",
      assetUrl,
      cost,
      impressions,
      clicks,
      installs,
      week: file.week,
      period,
      ctr: 0,
      clickToInstall: 0,
      costPerInstall: 0,
      count: 1,
      sourceFile: file.name
    };

    // Exclude rows with zero/no activity from main analysis.
    if (!hasMeaningfulActivity({ cost, impressions, clicks, installs })) {
      inactive.push({ ...base, inactiveReason: "No cost, impressions, clicks, or installs" });
      continue;
    }

    // Exclude rows without asset identity.
    if (!asset && !assetType) {
      inactive.push({ ...base, inactiveReason: "Missing asset and asset type" });
      continue;
    }

    normalized.push(base);
  }

  APP.inactiveRows.push(...inactive);
  return normalized;
}

function mapGoogleChannel(raw) {
  const s = (raw || "").toUpperCase().trim();

  if (s.includes("SEARCH_PARTNER") || s.includes("SEARCH PARTNER")) return "Search Partner";
  if (s.includes("SEARCH")) return "Google Search";
  if (s.includes("DISPLAY") || s.includes("GDN") || s.includes("CONTENT")) return "GDN";
  if (s.includes("YOUTUBE")) return "YouTube";
  if (s.includes("GMAIL")) return "Gmail";
  if (s.includes("MAPS")) return "Maps";
  if (s) return s;

  return "";
}

function normalizeGoogleAssetType(raw) {
  const s = (raw || "").toLowerCase().trim();

  if (s.includes("headline")) return "Headline";
  if (s.includes("description") || s.includes("copywriting")) return "Description";
  if (s.includes("youtube") && s.includes("video")) return "YouTube Video";
  if (s.includes("marketing image") || (s.includes("image") && !s.includes("motion"))) return "Static Image";
  if (s.includes("motion") || s.includes("video")) return "Video";
  if (s) return raw.trim();

  return "Other";
}

// ============================================
// META ADS NORMALIZATION
// ============================================
function normalizeMetaAds(file) {
  const { headers, rows } = file;
  const normalized = [];
  const inactive = [];

  const hasClicks = headers.some(h => h.toLowerCase().includes("click") && !h.toLowerCase().includes("cost"));

  for (const row of rows) {
    const adName = getCol(row, headers, ["ad name"]);
    const adSetName = getCol(row, headers, ["ad set name", "adset name"]) || file.adGroupOverride || "";
    const campaign = getCol(row, headers, ["campaign name", "campaign"]) || file.campaignOverride || "";
    const rawCost = cleanNumber(getColExact(row, headers, ['amount spent (idr)', 'amount spent', 'spent']));
    const cost = rawCost / 13000;
    const impressions = cleanNumber(getCol(row, headers, ["impressions"]));

    let clicks = 0;
    if (hasClicks) {
      clicks = cleanNumber(getColExact(row, headers, [
        "link clicks",
        "clicks (all)",
        "clicks",
        "outbound clicks"
      ]));
    }

    let installs = 0;
    const mobileInstalls = cleanNumber(getCol(row, headers, ["mobile app installs"]));
    const desktopInstalls = cleanNumber(getCol(row, headers, ["desktop app installs"]));

    if (mobileInstalls || desktopInstalls) {
      installs = mobileInstalls + desktopInstalls;
    } else {
      const resultIndicator = getCol(row, headers, ["result indicator", "result type", "optimization goal"]);
      const results = cleanNumber(getCol(row, headers, ["results"]));

      if ((resultIndicator || "").toLowerCase().includes("install") ||
          (resultIndicator || "").toLowerCase().includes("app")) {
        installs = results;
      } else if (results > 0 && !resultIndicator) {
        installs = results;
      }
    }

    const qualityRanking = getCol(row, headers, ["quality ranking"]);
    const engagementRanking = getCol(row, headers, ["engagement rate ranking", "engagement ranking"]);
    const conversionRanking = getCol(row, headers, ["conversion rate ranking", "conversion ranking"]);
    const period = detectRowPeriod(row, headers, file);

    const base = {
      platform: "meta",
      channel: inferMetaChannel(row, headers),
      campaign: campaign || "Unknown Campaign",
      adGroup: adSetName || "Unknown Ad Set",
      assetType: inferMetaAssetType(adName),
      asset: adName || "Unknown Ad",
      cost,
      impressions,
      clicks: hasClicks ? clicks : null,
      installs,
      week: file.week,
      period,
      hasClicks,
      qualityRanking: qualityRanking || "",
      engagementRanking: engagementRanking || "",
      conversionRanking: conversionRanking || "",
      ctr: 0,
      clickToInstall: 0,
      costPerInstall: 0,
      count: 1,
      sourceFile: file.name
    };

    if (!hasMeaningfulActivity({ cost, impressions, clicks: clicks || 0, installs })) {
      inactive.push({ ...base, inactiveReason: "No cost, impressions, clicks, or installs" });
      continue;
    }

    if (!adName && !adSetName && !campaign) {
      inactive.push({ ...base, inactiveReason: "Missing ad identity" });
      continue;
    }

    normalized.push(base);
  }

  APP.inactiveRows.push(...inactive);
  return normalized;
}

function inferMetaChannel(row, headers) {
  const publisher = getCol(row, headers, ["publisher platform", "platform", "placement"]);

  const s = (publisher || "").toLowerCase();
  if (s.includes("instagram")) return "Instagram";
  if (s.includes("facebook")) return "Facebook";
  if (s.includes("audience")) return "Audience Network";
  if (s.includes("messenger")) return "Messenger";

  return "Meta";
}

function inferMetaAssetType(adName) {
  const s = (adName || "").toLowerCase();

  if (s.includes("kol")) return "KOL";
  if (s.includes("social") || s.includes("sosmed") || s.includes("socmed") || s.includes("tiktok style") || s.includes("reels") || s.includes("video")) return "Social Media";
  if (s.includes("vina")) return "Vina Post Lebaran";
  if (s.includes("carousel")) return "Job Listing Carousel";
  if (s.includes("static") || s.includes("image") || s.includes("banner")) return "Static Image";

  return "Uncategorized";
}

function inferFromFilename(name, type) {
  // Keep empty for now because filenames are usually not reliable enough.
  return "";
}

function applyAutoWeekAssignment(rows) {
  const periodMap = new Map();

  for (const row of rows) {
    if (row.week !== "auto" || !row.period) continue;

    const key = `${row.period.start}||${row.period.end}`;
    if (!periodMap.has(key)) {
      periodMap.set(key, {
        key,
        start: row.period.start,
        end: row.period.end,
        sortTime: row.period.sortTime || 0
      });
    }
  }

  const periods = [...periodMap.values()].sort((a, b) => b.sortTime - a.sortTime);
  const weekByPeriod = new Map();

  if (periods[0]) weekByPeriod.set(periods[0].key, "current");
  if (periods[1]) weekByPeriod.set(periods[1].key, "previous");
  for (const period of periods.slice(2)) weekByPeriod.set(period.key, "older");

  for (const row of rows) {
    if (row.week !== "auto") continue;

    if (!row.period) {
      row.week = "current";
      continue;
    }

    const key = `${row.period.start}||${row.period.end}`;
    row.week = weekByPeriod.get(key) || "current";
  }
}

// ============================================
// GROUPING & AGGREGATION
// ============================================
function groupAndAggregate(rows, options = {}) {
  const collapseGooglePlacement = options.collapseGooglePlacement !== false;
  const grouped = new Map();

  for (const row of rows) {
    if (!hasMeaningfulActivity({
      cost: row.cost,
      impressions: row.impressions,
      clicks: row.clicks || 0,
      installs: row.installs
    })) {
      continue;
    }

    const channel = row.platform === "google" && collapseGooglePlacement
      ? "All Google placements"
      : row.channel;
    const key = `${row.week}||${row.platform}||${channel}||${row.campaign}||${row.adGroup}||${row.assetType}||${row.asset}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        platform: row.platform,
        channel,
        campaign: row.campaign,
        adGroup: row.adGroup,
        assetType: row.assetType,
        asset: row.asset,
        assetUrl: row.assetUrl || "",
        cost: 0,
        impressions: 0,
        clicks: 0,
        installs: 0,
        count: 0,
        hasClicks: row.hasClicks !== false,
        qualityRanking: row.qualityRanking || "",
        engagementRanking: row.engagementRanking || "",
        conversionRanking: row.conversionRanking || "",
        week: row.week
      });
    }

    const g = grouped.get(key);

    g.cost += row.cost || 0;
    g.impressions += row.impressions || 0;

    if (row.clicks !== null) g.clicks += row.clicks || 0;
    else g.hasClicks = false;

    g.installs += row.installs || 0;
    g.count += 1;

    if (row.qualityRanking) g.qualityRanking = row.qualityRanking;
    if (row.engagementRanking) g.engagementRanking = row.engagementRanking;
    if (row.conversionRanking) g.conversionRanking = row.conversionRanking;
    if (!g.assetUrl && row.assetUrl) g.assetUrl = row.assetUrl;
  }

  const result = [];

  for (const g of grouped.values()) {
    g.ctr = g.hasClicks ? safeDivide(g.clicks, g.impressions) : null;
    g.clickToInstall = (g.hasClicks && g.clicks > 0) ? safeDivide(g.installs, g.clicks) : null;
    g.costPerInstall = safeDivide(g.cost, g.installs);
    g.benchmarkKey = benchmarkKeyForRow(g);
    result.push(g);
  }

  return result;
}

// ============================================
// BENCHMARKING & ACTION PLAN
// ============================================
function benchmarkKeyForRow(row) {
  return `${row.campaign}||${row.adGroup}||${row.assetType}`;
}

function benchmarkLabelForRow(row) {
  return `${row.campaign} / ${row.adGroup} / ${row.assetType}`;
}

function computeBenchmarks(groupedRows) {
  const activeRows = groupedRows.filter(r =>
    hasMeaningfulActivity({
      cost: r.cost,
      impressions: r.impressions,
      clicks: r.clicks || 0,
      installs: r.installs
    })
  );

  const byScope = {};

  for (const row of activeRows) {
    const key = benchmarkKeyForRow(row);
    if (!byScope[key]) byScope[key] = [];
    byScope[key].push(row);
  }

  const benchmarks = {};

  for (const [key, rows] of Object.entries(byScope)) {
    const ctrs = rows.filter(r => r.ctr !== null && r.ctr > 0).map(r => r.ctr);
    const c2is = rows.filter(r => r.clickToInstall !== null && r.clickToInstall > 0).map(r => r.clickToInstall);
    const cpis = rows.filter(r => r.costPerInstall > 0).map(r => r.costPerInstall);
    const costs = rows.filter(r => r.cost > 0).map(r => r.cost);
    const installs = rows.filter(r => r.installs > 0).map(r => r.installs);

    benchmarks[key] = {
      key,
      label: benchmarkLabelForRow(rows[0]),
      campaign: rows[0].campaign,
      adGroup: rows[0].adGroup,
      assetType: rows[0].assetType,
      medianCTR: median(ctrs),
      medianClickToInstall: median(c2is),
      medianCPI: median(cpis),
      medianCost: median(costs),
      medianInstalls: median(installs),
      count: rows.length
    };
  }

  return benchmarks;
}

function assignActionPlan(row, benchmarks) {
  if (!hasMeaningfulActivity({
    cost: row.cost,
    impressions: row.impressions,
    clicks: row.clicks || 0,
    installs: row.installs
  })) {
    return "INACTIVE";
  }

  const bench = benchmarks[row.benchmarkKey || benchmarkKeyForRow(row)];
  if (!bench) return "N/A";

  const actionGuardrail = APP.actionMetricGuardrails[row.platform] || {};
  const ctrTarget = actionGuardrail.ctr > 0 ? actionGuardrail.ctr : bench.medianCTR;
  const c2iTarget = actionGuardrail.clickToInstall > 0 ? actionGuardrail.clickToInstall : bench.medianClickToInstall;

  // Definition: CHANGE means CTR clears the threshold but Click>Install does not.
  // PAUSE / REPLACE means CTR is below threshold, regardless of downstream conversion.
  if (row.ctr !== null && ctrTarget > 0) {
    const ctrAbove = row.ctr >= ctrTarget;
    const c2iAbove = row.clickToInstall !== null && c2iTarget > 0
      ? row.clickToInstall >= c2iTarget
      : true;

    if (ctrAbove && c2iAbove) return "STAY";
    if (ctrAbove && !c2iAbove) return "CHANGE";
    return "PAUSE";
  }

  // Fallback when clicks/CTR unavailable.
  if (row.costPerInstall > 0 && bench.medianCPI > 0) {
    const cpiBelow = row.costPerInstall <= bench.medianCPI;
    const installsAbove = row.installs >= bench.medianInstalls;

    if (cpiBelow && installsAbove) return "STAY";
    if (!cpiBelow && installsAbove) return "CHANGE";
    return "PAUSE";
  }

  // Meta ranking fallback.
  if (row.qualityRanking || row.engagementRanking || row.conversionRanking) {
    return assignActionFromRankings(row);
  }

  return "N/A";
}

function assignActionFromRankings(row) {
  const quality = rankingScore(row.qualityRanking);
  const engagement = rankingScore(row.engagementRanking);
  const conversion = rankingScore(row.conversionRanking);

  if (quality >= 2 && engagement >= 2 && conversion >= 2) return "STAY";
  if (engagement >= 2 && conversion < 2) return "CHANGE";
  if (engagement < 2 || quality < 2) return "PAUSE";

  return "N/A";
}

function rankingScore(val) {
  const s = (val || "").toLowerCase();

  if (s.includes("above")) return 3;
  if (s.includes("average") && !s.includes("below")) return 2;
  if (s.includes("below")) return 1;

  return 0;
}

// ============================================
// PLACEMENT ANALYSIS
// ============================================
function computePlacementAnalysis(groupedRows) {
  const byPlacement = new Map();

  for (const row of groupedRows) {
    if (!hasMeaningfulActivity({
      cost: row.cost,
      impressions: row.impressions,
      clicks: row.clicks || 0,
      installs: row.installs
    })) {
      continue;
    }

    const key = `${row.platform}||${row.campaign}||${row.adGroup}||${row.assetType}||${row.channel}`;

    if (!byPlacement.has(key)) {
      byPlacement.set(key, {
        platform: row.platform,
        campaign: row.campaign,
        adGroup: row.adGroup,
        assetType: row.assetType,
        placement: row.channel,
        cost: 0,
        impressions: 0,
        clicks: 0,
        installs: 0,
        hasClicks: row.hasClicks !== false
      });
    }

    const p = byPlacement.get(key);

    p.cost += row.cost;
    p.impressions += row.impressions;

    if (row.clicks !== null) p.clicks += row.clicks;
    else p.hasClicks = false;

    p.installs += row.installs;
  }

  const campaignTotals = {};
  const campaignPlacementTotals = {};

  for (const p of byPlacement.values()) {
    const totalKey = `${p.platform}||${p.campaign}`;
    if (!campaignTotals[totalKey]) campaignTotals[totalKey] = 0;
    campaignTotals[totalKey] += p.cost;

    const placementKey = `${p.platform}||${p.campaign}||${p.placement}`;
    if (!campaignPlacementTotals[placementKey]) campaignPlacementTotals[placementKey] = 0;
    campaignPlacementTotals[placementKey] += p.cost;
  }

  const results = [];

  for (const p of byPlacement.values()) {
    const totalKey = `${p.platform}||${p.campaign}`;
    const placementKey = `${p.platform}||${p.campaign}||${p.placement}`;
    const costShare = safeDivide(campaignPlacementTotals[placementKey], campaignTotals[totalKey]);
    const ctr = p.hasClicks ? safeDivide(p.clicks, p.impressions) : null;
    const clickToInstall = (p.hasClicks && p.clicks > 0) ? safeDivide(p.installs, p.clicks) : null;
    const costPerInstall = safeDivide(p.cost, p.installs);
    const guardrailStatus = checkGuardrail(p.platform, p.campaign, p.placement, costShare);

    results.push({
      ...p,
      ctr,
      clickToInstall,
      costPerInstall,
      costShare,
      rowCostShare: safeDivide(p.cost, campaignTotals[totalKey]),
      guardrailStatus,
      actionPlan: guardrailStatus === "Above Guardrail" ? "PAUSE" : "STAY"
    });
  }

  return results;
}

function checkGuardrail(platform, campaign, placement, costShare) {
  const pct = costShare * 100;

  if (platform === "meta") {
    const limit = APP.guardrails.meta[placement];

    if (limit && pct > limit) return "Above Guardrail";
    if (limit) return "Within Guardrail";

    return "N/A";
  }

  if (platform === "google") {
    const config = APP.guardrails.google.find(g =>
      (g.campaign || "").toLowerCase().trim() === (campaign || "").toLowerCase().trim()
    );

    if (!config) return "N/A";

    let limit = null;

    if (placement === "Google Search") limit = config.search;
    else if (placement === "GDN") limit = config.gdn;
    else if (placement === "YouTube") limit = config.youtube;

    if (limit && pct > limit) return "Above Guardrail";
    if (limit) return "Within Guardrail";

    return "N/A";
  }

  return "N/A";
}

// ============================================
// WEEK-OVER-WEEK ANALYSIS
// ============================================
function computeWoW(allGrouped) {
  const current = aggregateRowsForWoW(allGrouped.filter(r => r.week === "current"));
  const previous = aggregateRowsForWoW(allGrouped.filter(r => r.week === "previous"));

  if (!current.length || !previous.length) return [];

  const prevMap = new Map();

  for (const r of previous) {
    const key = wowCompareKey(r);
    prevMap.set(key, r);
  }

  const results = [];

  for (const curr of current) {
    const key = wowCompareKey(curr);
    const prev = prevMap.get(key);
    if (!prev) continue;

    const currActive = hasMeaningfulActivity({
      cost: curr.cost,
      impressions: curr.impressions,
      clicks: curr.clicks || 0,
      installs: curr.installs
    });

    const prevActive = hasMeaningfulActivity({
      cost: prev.cost,
      impressions: prev.impressions,
      clicks: prev.clicks || 0,
      installs: prev.installs
    });

    if (!currActive && !prevActive) continue;

    const wowCost = prev.cost > 0 ? safeDivide(curr.cost - prev.cost, prev.cost) : null;
    const wowImpr = prev.impressions > 0 ? safeDivide(curr.impressions - prev.impressions, prev.impressions) : null;
    const wowClicks = (curr.hasClicks && prev.hasClicks && prev.clicks > 0)
      ? safeDivide(curr.clicks - prev.clicks, prev.clicks)
      : null;
    const wowCTR = (curr.ctr !== null && prev.ctr !== null && prev.ctr > 0)
      ? safeDivide(curr.ctr - prev.ctr, prev.ctr)
      : null;
    const wowC2I = (curr.clickToInstall !== null && prev.clickToInstall !== null && prev.clickToInstall > 0)
      ? safeDivide(curr.clickToInstall - prev.clickToInstall, prev.clickToInstall)
      : null;
    const wowInstalls = prev.installs > 0
      ? safeDivide(curr.installs - prev.installs, prev.installs)
      : null;
    const wowCPI = (curr.costPerInstall > 0 && prev.costPerInstall > 0)
      ? safeDivide(curr.costPerInstall - prev.costPerInstall, prev.costPerInstall)
      : null;

    const flags = [];

    const rules = APP.wowFlagRules || {};
    const ctrDropLimit = Number(rules.ctrDrop ?? 0.2);
    const c2iDropLimit = Number(rules.c2iDrop ?? 0.2);
    const cpiIncreaseLimit = Number(rules.cpiIncrease ?? 0.2);

    if (ctrDropLimit > 0 && wowCTR !== null && wowCTR < -ctrDropLimit) flags.push(`CTR drop >${fmtRulePct(ctrDropLimit)}`);
    if (c2iDropLimit > 0 && wowC2I !== null && wowC2I < -c2iDropLimit) flags.push(`Click>Install% drop >${fmtRulePct(c2iDropLimit)}`);
    if (cpiIncreaseLimit > 0 && wowCPI !== null && wowCPI > cpiIncreaseLimit) flags.push(`CPI increase >${fmtRulePct(cpiIncreaseLimit)}`);
    if (rules.costUpInstallsDown !== false && wowCost !== null && wowCost > 0 && wowInstalls !== null && wowInstalls < 0) flags.push("Cost up, Installs down");
    if (rules.stoppedInstalls !== false && curr.installs === 0 && prev.installs > 0) flags.push("Stopped / no installs this week");
    if (rules.newInstalls !== false && curr.installs > 0 && prev.installs === 0) flags.push("New / reactivated installs");

    results.push({
      platform: curr.platform,
      channel: curr.channel,
      campaign: curr.campaign,
      adGroup: curr.adGroup,
      assetType: curr.assetType,
      asset: curr.asset,
      currCost: curr.cost,
      prevCost: prev.cost,
      wowCost,
      currImpr: curr.impressions,
      prevImpr: prev.impressions,
      wowImpr,
      currClicks: curr.clicks,
      prevClicks: prev.clicks,
      wowClicks,
      currCTR: curr.ctr,
      prevCTR: prev.ctr,
      wowCTR,
      currC2I: curr.clickToInstall,
      prevC2I: prev.clickToInstall,
      wowC2I,
      currInstalls: curr.installs,
      prevInstalls: prev.installs,
      wowInstalls,
      currCPI: curr.costPerInstall,
      prevCPI: prev.costPerInstall,
      wowCPI,
      flags
    });
  }

  return results;
}

function fmtRulePct(value) {
  return `${Math.round(value * 100)}%`;
}

function aggregateRowsForWoW(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const key = wowCompareKey(row);

    if (!grouped.has(key)) {
      grouped.set(key, {
        platform: row.platform,
        channel: row.platform === "google" ? "All Google placements" : row.channel,
        campaign: row.campaign,
        adGroup: row.adGroup,
        assetType: row.assetType,
        asset: row.asset,
        cost: 0,
        impressions: 0,
        clicks: 0,
        installs: 0,
        count: 0,
        hasClicks: row.hasClicks !== false,
        week: row.week
      });
    }

    const g = grouped.get(key);
    g.cost += row.cost || 0;
    g.impressions += row.impressions || 0;

    if (row.clicks !== null) g.clicks += row.clicks || 0;
    else g.hasClicks = false;

    g.installs += row.installs || 0;
    g.count += row.count || 1;
  }

  return [...grouped.values()].map(g => {
    g.ctr = g.hasClicks ? safeDivide(g.clicks, g.impressions) : null;
    g.clickToInstall = (g.hasClicks && g.clicks > 0) ? safeDivide(g.installs, g.clicks) : null;
    g.costPerInstall = safeDivide(g.cost, g.installs);
    return g;
  });
}

function wowCompareKey(row) {
  const placementPart = row.platform === "google" ? "" : row.channel;
  return `${row.platform}||${placementPart}||${row.campaign}||${row.adGroup}||${row.assetType}||${row.asset}`;
}

// ============================================
// MAIN ANALYSIS PIPELINE
// ============================================
function runAnalysis() {
  APP.inactiveRows = [];

  let allGoogle = [];
  let allMeta = [];

  for (const file of APP.files) {
    if (file.platform === "google") {
      allGoogle = allGoogle.concat(normalizeGoogleAds(file));
    } else if (file.platform === "meta") {
      allMeta = allMeta.concat(normalizeMetaAds(file));
    }
  }

  applyAutoWeekAssignment([...allGoogle, ...allMeta]);

  APP.googleRows = groupAndAggregate(allGoogle);
  const googlePlacementRows = groupAndAggregate(allGoogle, { collapseGooglePlacement: false });
  APP.metaRows = groupAndAggregate(allMeta);

  const currentGoogle = APP.googleRows.filter(r => r.week === "current");
  const currentGooglePlacementRows = googlePlacementRows.filter(r => r.week === "current");
  const currentMeta = APP.metaRows.filter(r => r.week === "current");

  const googleBenchmarks = computeBenchmarks(currentGoogle);
  const metaBenchmarks = computeBenchmarks(currentMeta);

  for (const row of APP.googleRows) {
    row.actionPlan = assignActionPlan(row, googleBenchmarks);
  }

  for (const row of APP.metaRows) {
    row.actionPlan = assignActionPlan(row, metaBenchmarks);
  }

  APP.googleBenchmarks = googleBenchmarks;
  APP.metaBenchmarks = metaBenchmarks;

  APP.placementGoogle = computePlacementAnalysis(currentGooglePlacementRows);
  APP.placementMeta = computePlacementAnalysis(currentMeta);

  const allGroupedForWoW = [...APP.googleRows, ...APP.metaRows];
  APP.wowResults = computeWoW(allGroupedForWoW);

  renderAllTabs();
  updateStats();
}

// ============================================
// RENDERING - FILES LIST
// ============================================
function renderFilesList() {
  const panel = document.getElementById("filesPanel");
  const list = document.getElementById("filesList");
  const badge = document.getElementById("fileCountBadge");

  if (!panel || !list) return;

  if (!APP.files.length) {
    panel.style.display = "none";
    const previewPanel = document.getElementById("previewPanel");
    if (previewPanel) previewPanel.style.display = "none";
    return;
  }

  panel.style.display = "";
  if (badge) badge.textContent = `${APP.files.length} files`;

  list.innerHTML = APP.files.map(f => `
    <div class="file-card" data-id="${esc(f.id)}">
      <div class="file-card-info">
        <span class="platform-badge ${esc(f.platform)}">${f.platform === "google" ? "Google Ads" : f.platform === "meta" ? "Meta Ads" : "Unknown"}</span>
        <div>
          <div class="file-card-name">${esc(f.name)}</div>
          <div class="file-card-meta">${fmtNum(f.rows.length)} rows${f.dateRange ? " | " + esc(f.dateRange.start) + " - " + esc(f.dateRange.end) : ""}</div>
          <div class="file-overrides">
            <label>
              <span>Campaign fallback</span>
              <input type="text" class="file-override-input" data-id="${esc(f.id)}" data-override="campaignOverride" value="${esc(f.campaignOverride || "")}" placeholder="Used if CSV campaign is blank" />
            </label>
            <label>
              <span>Ad group fallback</span>
              <input type="text" class="file-override-input" data-id="${esc(f.id)}" data-override="adGroupOverride" value="${esc(f.adGroupOverride || "")}" placeholder="Used if CSV ad group is blank" />
            </label>
          </div>
        </div>
      </div>
      <div class="file-card-actions">
        <select class="week-select" data-id="${esc(f.id)}" data-field="week">
          <option value="auto" ${f.week === "auto" ? "selected" : ""}>Auto Week</option>
          <option value="current" ${f.week === "current" ? "selected" : ""}>Current Week</option>
          <option value="previous" ${f.week === "previous" ? "selected" : ""}>Previous Week</option>
        </select>
        <select class="week-select" data-id="${esc(f.id)}" data-field="platform">
          <option value="google" ${f.platform === "google" ? "selected" : ""}>Google Ads</option>
          <option value="meta" ${f.platform === "meta" ? "selected" : ""}>Meta Ads</option>
          <option value="unknown" ${f.platform === "unknown" ? "selected" : ""}>Unknown</option>
        </select>
        <button class="btn btn-sm btn-ghost" data-preview="${esc(f.id)}">Preview</button>
        <button class="btn btn-sm btn-ghost btn-danger" data-remove="${esc(f.id)}">Remove</button>
      </div>
    </div>
  `).join("");

  list.querySelectorAll("[data-field='week']").forEach(sel => {
    sel.addEventListener("change", e => {
      const file = APP.files.find(f => f.id === e.target.dataset.id);
      if (file) {
        file.week = e.target.value;
        runAnalysis();
      }
    });
  });

  list.querySelectorAll("[data-field='platform']").forEach(sel => {
    sel.addEventListener("change", e => {
      const file = APP.files.find(f => f.id === e.target.dataset.id);
      if (file) {
        file.platform = e.target.value;
        renderFilesList();
        runAnalysis();
      }
    });
  });

  list.querySelectorAll("[data-override]").forEach(input => {
    input.addEventListener("change", e => {
      const file = APP.files.find(f => f.id === e.target.dataset.id);
      if (file) {
        file[e.target.dataset.override] = e.target.value.trim();
        runAnalysis();
      }
    });
  });

  list.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", e => {
      APP.files = APP.files.filter(f => f.id !== e.target.dataset.remove);
      renderFilesList();
      runAnalysis();
    });
  });

  list.querySelectorAll("[data-preview]").forEach(btn => {
    btn.addEventListener("click", e => {
      const file = APP.files.find(f => f.id === e.target.dataset.preview);
      if (file) renderPreview(file);
    });
  });
}

function renderPreview(file) {
  const panel = document.getElementById("previewPanel");
  const table = document.getElementById("previewTable");

  if (!panel || !table) return;

  panel.style.display = "";

  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");

  thead.innerHTML = `<tr>${file.headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr>`;
  tbody.innerHTML = file.rows.slice(0, 10).map(row =>
    `<tr>${file.headers.map((_, i) => `<td>${esc(row[i] || "")}</td>`).join("")}</tr>`
  ).join("");
}

// ============================================
// RENDERING - MAIN TABS
// ============================================
function renderAllTabs() {
  renderGoogleAnalysis();
  renderMetaAnalysis();
  renderPlacementAnalysis();
  renderWoWAnalysis();
  renderSummary();
}

function getCurrentActiveRows(rows) {
  return rows.filter(r =>
    r.week === "current" &&
    hasMeaningfulActivity({
      cost: r.cost,
      impressions: r.impressions,
      clicks: r.clicks || 0,
      installs: r.installs
    })
  );
}

function renderGoogleAnalysis() {
  const noData = document.getElementById("googleNoData");
  const analysis = document.getElementById("googleAnalysis");

  if (!noData || !analysis) return;

  const rows = getCurrentActiveRows(APP.googleRows);

  if (!rows.length) {
    noData.style.display = "";
    analysis.style.display = "none";
    return;
  }

  noData.style.display = "none";
  analysis.style.display = "";

  renderMetricFilterSummary("googleMetricFilters", "google", APP.googleBenchmarks);
  const filteredRows = applyMetricFilters(rows, "google");
  const hideMetrics = APP.hideMetrics && APP.hideMetrics.google;

  if (hideMetrics) {
    clearMetricSummarySections("google");
  } else {
    renderCampaignSummaryCards("googleCampaignSummary", filteredRows);
    renderAdGroupAssetTypeCards("googleAdGroupAssetTypeSummary", filteredRows);
    clearElement("googleAssetTypeSummary");
    renderBenchmarks("googleBenchmarks", APP.googleBenchmarks);
  }
  renderAnalysisTable("googleTable", rows, APP.googleBenchmarks, "google");
}

function renderMetaAnalysis() {
  const noData = document.getElementById("metaNoData");
  const analysis = document.getElementById("metaAnalysis");

  if (!noData || !analysis) return;

  const rows = getCurrentActiveRows(APP.metaRows);

  if (!rows.length) {
    noData.style.display = "";
    analysis.style.display = "none";
    return;
  }

  noData.style.display = "none";
  analysis.style.display = "";

  renderMetricFilterSummary("metaMetricFilters", "meta", APP.metaBenchmarks);
  const filteredRows = applyMetricFilters(rows, "meta");
  const hideMetrics = APP.hideMetrics && APP.hideMetrics.meta;

  if (hideMetrics) {
    clearMetricSummarySections("meta");
  } else {
    renderCampaignSummaryCards("metaCampaignSummary", filteredRows);
    renderAdGroupAssetTypeCards("metaAdGroupAssetTypeSummary", filteredRows);
    clearElement("metaAssetTypeSummary");
    renderBenchmarks("metaBenchmarks", APP.metaBenchmarks);
  }
  renderAnalysisTable("metaTable", rows, APP.metaBenchmarks, "meta");
}

function clearElement(id) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = "";
}

function clearMetricSummarySections(platform) {
  [
    `${platform}CampaignSummary`,
    `${platform}AdGroupAssetTypeSummary`,
    `${platform}AssetTypeSummary`,
    `${platform}Benchmarks`
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
  });
}

function getMetricFilterConfig(benchmarks = {}) {
  return [
    { key: "count", label: "Count", kind: "number", get: r => r.count, format: fmtNum },
    { key: "cost", label: "Cost", kind: "number", get: r => r.cost, format: fmtCurrency },
    { key: "impressions", label: "Impr.", kind: "number", get: r => r.impressions, format: fmtNum },
    { key: "clicks", label: "Clicks", kind: "number", get: r => r.hasClicks !== false ? r.clicks : null, format: fmtNum },
    { key: "ctr", label: "CTR", kind: "number", get: r => r.ctr, format: fmtPct },
    { key: "clickToInstall", label: "Click>Install%", kind: "number", get: r => r.clickToInstall, format: fmtPct },
    { key: "installs", label: "Installs", kind: "number", get: r => r.installs, format: fmtNum },
    { key: "costPerInstall", label: "Cost/Install", kind: "number", get: r => r.installs > 0 ? r.costPerInstall : null, format: fmtCurrency },
    {
      key: "ctrVsMed",
      label: "CTR vs Med",
      kind: "number",
      get: r => {
        const bench = benchmarks[r.benchmarkKey || benchmarkKeyForRow(r)] || {};
        return (r.ctr !== null && bench.medianCTR) ? r.ctr / bench.medianCTR - 1 : null;
      },
      format: renderFilterPctDelta
    },
    {
      key: "c2iVsMed",
      label: "C2I vs Med",
      kind: "number",
      get: r => {
        const bench = benchmarks[r.benchmarkKey || benchmarkKeyForRow(r)] || {};
        return (r.clickToInstall !== null && bench.medianClickToInstall) ? r.clickToInstall / bench.medianClickToInstall - 1 : null;
      },
      format: renderFilterPctDelta
    }
  ];
}

function getDimensionFilterConfig() {
  return [
    { key: "channel", label: "Channel", kind: "text", get: r => r.channel, format: String },
    { key: "campaign", label: "Campaign", kind: "text", get: r => r.campaign, format: String },
    { key: "adGroup", label: "Ad Group", kind: "text", get: r => r.adGroup, format: String },
    { key: "assetType", label: "Asset Type", kind: "text", get: r => r.assetType, format: String }
  ];
}

function getTableFilterConfig(benchmarks = {}) {
  return [...getDimensionFilterConfig(), ...getMetricFilterConfig(benchmarks)];
}

function ensureMetricFilters(platform) {
  if (!APP.metricFilters) APP.metricFilters = {};
  if (!APP.metricFilters[platform]) APP.metricFilters[platform] = {};
  return APP.metricFilters[platform];
}

function renderMetricFilterSummary(containerId, platform, benchmarks) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const filters = ensureMetricFilters(platform);
  const active = getTableFilterConfig(benchmarks)
    .filter(cfg => Array.isArray(filters[cfg.key]) && filters[cfg.key].length)
    .map(cfg => {
      const selected = filters[cfg.key].filter(v => v !== NO_METRIC_VALUES_SELECTED);
      return `${cfg.label}: ${selected.length} selected`;
    });

  if (!active.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="metric-filter-summary-inner">
      <span>${active.map(esc).join(" | ")}</span>
      <button class="btn btn-sm btn-ghost" data-reset-filters="${esc(platform)}">Reset filters</button>
    </div>
  `;

  const resetBtn = container.querySelector("[data-reset-filters]");
  if (resetBtn) {
    resetBtn.addEventListener("click", e => {
      APP.metricFilters[e.target.dataset.resetFilters] = {};
      renderAllTabs();
    });
  }
}

function applyMetricFilters(rows, platform) {
  const filters = ensureMetricFilters(platform);
  const benchmarks = platform === "google" ? APP.googleBenchmarks : APP.metaBenchmarks;
  const configs = getTableFilterConfig(benchmarks);

  return rows.filter(row => {
    for (const cfg of configs) {
      const selected = filters[cfg.key];
      if (!Array.isArray(selected) || !selected.length) continue;
      if (selected.includes(NO_METRIC_VALUES_SELECTED)) return false;
      if (!selected.includes(metricFilterValueKey(cfg, row))) return false;
    }

    return true;
  });
}

function metricFilterValueKey(cfg, row) {
  const value = cfg.get(row);
  return value === null || value === undefined ? "__blank__" : String(value);
}

function metricFilterDisplayValue(cfg, key) {
  if (key === "__blank__") return "-";
  return cfg.kind === "number" ? cfg.format(Number(key)) : cfg.format(key);
}

function getMetricFilterOptions(rows, cfg) {
  const map = new Map();

  for (const row of rows) {
    const key = metricFilterValueKey(cfg, row);
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: metricFilterDisplayValue(cfg, key),
        sortValue: cfg.kind === "number"
          ? (key === "__blank__" ? Number.POSITIVE_INFINITY : Number(key))
          : key.toLowerCase()
      });
    }
  }

  return [...map.values()].sort((a, b) => {
    if (cfg.kind === "number") return a.sortValue - b.sortValue;
    return a.sortValue.localeCompare(b.sortValue);
  });
}

function renderFilterPctDelta(val) {
  if (val === null || val === undefined) return "-";
  const sign = val >= 0 ? "+" : "";
  return `${sign}${(val * 100).toFixed(1)}%`;
}

function summarizeRows(items) {
  const totalCost = items.reduce((s, r) => s + r.cost, 0);
  const totalImpr = items.reduce((s, r) => s + r.impressions, 0);
  const totalClicks = items.reduce((s, r) => s + (r.clicks || 0), 0);
  const totalInstalls = items.reduce((s, r) => s + r.installs, 0);

  return {
    totalCost,
    totalImpr,
    totalClicks,
    totalInstalls,
    avgCTR: safeDivide(totalClicks, totalImpr),
    avgCPI: safeDivide(totalCost, totalInstalls),
    stayCount: items.filter(r => r.actionPlan === "STAY").length,
    changeCount: items.filter(r => r.actionPlan === "CHANGE").length,
    pauseCount: items.filter(r => r.actionPlan === "PAUSE").length
  };
}

function renderSummaryCard(title, subtitle, items) {
  const s = summarizeRows(items);

  return `
    <div class="asset-type-card">
      <h4>${esc(title)} <span class="badge">${items.length} rows</span></h4>
      ${subtitle ? `<div class="card-subtitle">${esc(subtitle)}</div>` : ""}
      <div class="card-metrics">
        <div class="card-metric"><span class="card-metric-label">Cost</span><span class="card-metric-value">${fmtCurrency(s.totalCost)}</span></div>
        <div class="card-metric"><span class="card-metric-label">Installs</span><span class="card-metric-value">${fmtNum(s.totalInstalls)}</span></div>
        <div class="card-metric"><span class="card-metric-label">Avg CTR</span><span class="card-metric-value">${fmtPct(s.avgCTR)}</span></div>
        <div class="card-metric"><span class="card-metric-label">Avg CPI</span><span class="card-metric-value">${fmtCurrency(s.avgCPI)}</span></div>
        <div class="card-metric"><span class="card-metric-label">Stay</span><span class="card-metric-value" style="color:var(--stay)">${s.stayCount}</span></div>
        <div class="card-metric"><span class="card-metric-label">Change</span><span class="card-metric-value" style="color:var(--change)">${s.changeCount}</span></div>
        <div class="card-metric"><span class="card-metric-label">Pause</span><span class="card-metric-value" style="color:var(--pause)">${s.pauseCount}</span></div>
      </div>
    </div>
  `;
}

function renderCampaignSummaryCards(containerId, rows) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const byCampaign = {};

  for (const r of rows) {
    if (!byCampaign[r.campaign]) byCampaign[r.campaign] = [];
    byCampaign[r.campaign].push(r);
  }

  const groups = Object.entries(byCampaign)
    .sort((a, b) => b[1].reduce((s, r) => s + r.cost, 0) - a[1].reduce((s, r) => s + r.cost, 0));

  if (!groups.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="summary-section-title">Campaign Analysis</div>
    ${groups.map(([campaign, items]) => renderSummaryCard(campaign, "All ad groups and asset types", items)).join("")}
  `;
}

function renderAdGroupAssetTypeCards(containerId, rows) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const byGroup = {};

  for (const r of rows) {
    const key = `${r.campaign}||${r.adGroup}||${r.assetType}`;
    if (!byGroup[key]) byGroup[key] = [];
    byGroup[key].push(r);
  }

  const groups = Object.entries(byGroup)
    .sort((a, b) => b[1].reduce((s, r) => s + r.cost, 0) - a[1].reduce((s, r) => s + r.cost, 0));

  if (!groups.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="summary-section-title">Asset Type Analysis by Ad Group</div>
    ${groups.map(([, items]) => {
      const first = items[0];
      return renderSummaryCard(first.assetType, `${first.campaign} / ${first.adGroup}`, items);
    }).join("")}
  `;
}

function renderAssetTypeCards(containerId, rows, benchmarks) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const byType = {};

  for (const r of rows) {
    if (!byType[r.assetType]) byType[r.assetType] = [];
    byType[r.assetType].push(r);
  }

  if (!Object.keys(byType).length) {
    container.innerHTML = `<p class="empty-state compact">No rows match the current filters.</p>`;
    return;
  }

  container.innerHTML = Object.entries(byType).map(([type, items]) => {
    return renderSummaryCard(type, "All campaigns and ad groups", items);
  }).join("");
}

function renderBenchmarks(containerId, benchmarks) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const types = Object.entries(benchmarks || {});
  if (!types.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <h4>Median Benchmarks by Campaign / Ad Group / Asset Type</h4>
    <div class="benchmark-groups">
      ${types.map(([, b]) => `
        <div class="benchmark-group">
          <div class="benchmark-group-title">${esc(b.label || b.assetType)}</div>
          <div class="benchmark-item"><span>CTR</span><span>${fmtPct(b.medianCTR)}</span></div>
          <div class="benchmark-item"><span>Click&gt;Install%</span><span>${fmtPct(b.medianClickToInstall)}</span></div>
          <div class="benchmark-item"><span>CPI</span><span>${fmtCurrency(b.medianCPI)}</span></div>
          <div class="benchmark-item"><span>Cost</span><span>${fmtCurrency(b.medianCost)}</span></div>
          <div class="benchmark-item"><span>Installs</span><span>${fmtNum(b.medianInstalls)}</span></div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderAnalysisTable(tableId, rows, benchmarks, platform) {
  const table = document.getElementById(tableId);
  if (!table) return;

  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  const metricConfigs = getMetricFilterConfig(benchmarks);
  const metricByKey = Object.fromEntries(metricConfigs.map(cfg => [cfg.key, cfg]));
  const dimensionConfigs = getDimensionFilterConfig();
  const dimensionByKey = Object.fromEntries(dimensionConfigs.map(cfg => [cfg.key, cfg]));
  const hideMetrics = APP.hideMetrics && APP.hideMetrics[platform];
  const showPlacementColumn = platform !== "google";
  const showCountColumn = platform !== "google";

  thead.innerHTML = `<tr>
    ${showPlacementColumn ? renderMetricHeader(dimensionByKey.channel, rows, platform, false) : ""}
    ${renderMetricHeader(dimensionByKey.campaign, rows, platform, false)}
    ${renderMetricHeader(dimensionByKey.adGroup, rows, platform, false)}
    ${renderMetricHeader(dimensionByKey.assetType, rows, platform, false)}
    <th>Asset</th>
    ${hideMetrics ? "" : `
      ${showCountColumn ? renderMetricHeader(metricByKey.count, rows, platform) : ""}
      ${renderMetricHeader(metricByKey.cost, rows, platform)}
      ${renderMetricHeader(metricByKey.impressions, rows, platform)}
      ${renderMetricHeader(metricByKey.clicks, rows, platform)}
      ${renderMetricHeader(metricByKey.ctr, rows, platform)}
      ${renderMetricHeader(metricByKey.clickToInstall, rows, platform)}
      ${renderMetricHeader(metricByKey.installs, rows, platform)}
      ${renderMetricHeader(metricByKey.costPerInstall, rows, platform)}
      ${renderMetricHeader(metricByKey.ctrVsMed, rows, platform, false)}
      ${renderMetricHeader(metricByKey.c2iVsMed, rows, platform, false)}
    `}
    <th>Action Plan</th>
  </tr>`;

  const activeRows = applyMetricFilters(rows.filter(r =>
    hasMeaningfulActivity({
      cost: r.cost,
      impressions: r.impressions,
      clicks: r.clicks || 0,
      installs: r.installs
    })
  ), platform);

  const sorted = [...activeRows].sort((a, b) => {
    if (a.assetType !== b.assetType) return a.assetType.localeCompare(b.assetType);
    return b.cost - a.cost;
  });

  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="${analysisTableColspan(showPlacementColumn, showCountColumn, hideMetrics)}" class="empty-table-cell">No rows match the current filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = sorted.map(row => {
    const bench = benchmarks[row.benchmarkKey || benchmarkKeyForRow(row)] || {};
    const ctrVsMed = (row.ctr !== null && bench.medianCTR) ? row.ctr / bench.medianCTR - 1 : null;
    const c2iVsMed = (row.clickToInstall !== null && bench.medianClickToInstall) ? row.clickToInstall / bench.medianClickToInstall - 1 : null;

    const rowClass =
      row.actionPlan === "STAY" ? "row-stay" :
      row.actionPlan === "CHANGE" ? "row-change" :
      row.actionPlan === "PAUSE" ? "row-pause" : "";

    return `<tr class="${rowClass}">
      ${showPlacementColumn ? `<td>${esc(row.channel)}</td>` : ""}
      <td>${esc(row.campaign)}</td>
      <td>${esc(row.adGroup)}</td>
      <td>${esc(row.assetType)}</td>
      <td>${renderAssetCell(row)}</td>
      ${hideMetrics ? "" : `
        ${showCountColumn ? `<td class="numeric">${fmtNum(row.count)}</td>` : ""}
        <td class="numeric">${fmtCurrency(row.cost)}</td>
        <td class="numeric">${fmtNum(row.impressions)}</td>
        <td class="numeric">${row.hasClicks !== false ? fmtNum(row.clicks) : "-"}</td>
        <td class="numeric">${row.ctr !== null ? fmtPct(row.ctr) : "-"}</td>
        <td class="numeric">${row.clickToInstall !== null ? fmtPct(row.clickToInstall) : "-"}</td>
        <td class="numeric">${fmtNum(row.installs)}</td>
        <td class="numeric">${row.installs > 0 ? fmtCurrency(row.costPerInstall) : "-"}</td>
        <td>${renderBenchIndicator(ctrVsMed)}</td>
        <td>${renderBenchIndicator(c2iVsMed)}</td>
      `}
      <td>${renderActionLabel(row.actionPlan)}</td>
    </tr>`;
  }).join("");

  wireMetricHeaderFilters(table, platform);
}

function analysisTableColspan(showPlacementColumn, showCountColumn, hideMetrics) {
  const dimensionCols = (showPlacementColumn ? 1 : 0) + 4; // campaign, ad group, asset type, asset
  const metricCols = hideMetrics ? 0 : (showCountColumn ? 10 : 9);
  return dimensionCols + metricCols + 1; // action plan
}

function renderAssetCell(row) {
  const label = row.asset || "-";
  const url = row.assetUrl || extractAssetUrl(label);

  if (!url) return `<strong>${esc(label)}</strong>`;

  return `<a class="asset-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(label)}</strong></a>`;
}

function extractAssetUrl(value) {
  const text = String(value || "").trim();
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : "";
}

function renderMetricHeader(cfg, rows, platform, numeric = true) {
  const filters = ensureMetricFilters(platform);
  const selected = Array.isArray(filters[cfg.key]) ? filters[cfg.key] : [];
  const options = getMetricFilterOptions(rows, cfg);
  const isFiltered = selected.length > 0;
  const checkedSet = new Set(selected.includes(NO_METRIC_VALUES_SELECTED) ? [] : selected.length ? selected : options.map(opt => opt.key));

  return `
    <th class="${numeric ? "numeric " : ""}filterable-th ${numeric ? "" : "text-filter-th"}">
      <details class="metric-filter-menu" data-metric-filter="${esc(cfg.key)}">
        <summary class="metric-filter-trigger ${isFiltered ? "active" : ""}">
          <span>${esc(cfg.label)}</span>
          <span class="filter-caret">▾</span>
        </summary>
        <div class="metric-filter-popover">
          <div class="metric-filter-popover-title">${esc(cfg.label)}</div>
          <div class="metric-filter-actions">
            <button type="button" class="btn btn-sm btn-ghost" data-filter-select-all="${esc(cfg.key)}">All</button>
            <button type="button" class="btn btn-sm btn-ghost" data-filter-clear="${esc(cfg.key)}">Clear</button>
          </div>
          <div class="metric-filter-options">
            ${options.map(opt => `
              <label class="metric-filter-option">
                <input type="checkbox" value="${esc(opt.key)}" ${checkedSet.has(opt.key) ? "checked" : ""} data-filter-option="${esc(cfg.key)}" />
                <span>${esc(opt.label)}</span>
              </label>
            `).join("")}
          </div>
          <div class="metric-filter-footer">
            <button type="button" class="btn btn-sm btn-primary" data-filter-apply="${esc(cfg.key)}">Apply</button>
            <button type="button" class="btn btn-sm btn-ghost" data-filter-reset="${esc(cfg.key)}">Reset</button>
          </div>
        </div>
      </details>
    </th>
  `;
}

function wireMetricHeaderFilters(table, platform) {
  table.querySelectorAll("[data-filter-select-all]").forEach(btn => {
    btn.addEventListener("click", e => {
      const key = e.target.dataset.filterSelectAll;
      table.querySelectorAll(`[data-filter-option="${cssEscape(key)}"]`).forEach(input => {
        input.checked = true;
      });
    });
  });

  table.querySelectorAll("[data-filter-clear]").forEach(btn => {
    btn.addEventListener("click", e => {
      const key = e.target.dataset.filterClear;
      table.querySelectorAll(`[data-filter-option="${cssEscape(key)}"]`).forEach(input => {
        input.checked = false;
      });
    });
  });

  table.querySelectorAll("[data-filter-apply]").forEach(btn => {
    btn.addEventListener("click", e => {
      const key = e.target.dataset.filterApply;
      const checked = [...table.querySelectorAll(`[data-filter-option="${cssEscape(key)}"]:checked`)]
        .map(input => input.value);
      const all = [...table.querySelectorAll(`[data-filter-option="${cssEscape(key)}"]`)]
        .map(input => input.value);
      const filters = ensureMetricFilters(platform);
      filters[key] = checked.length === all.length ? [] : checked.length ? checked : [NO_METRIC_VALUES_SELECTED];
      renderAllTabs();
    });
  });

  table.querySelectorAll("[data-filter-reset]").forEach(btn => {
    btn.addEventListener("click", e => {
      const filters = ensureMetricFilters(platform);
      delete filters[e.target.dataset.filterReset];
      renderAllTabs();
    });
  });
}

function cssEscape(value) {
  if (globalThis.CSS && globalThis.CSS.escape) return globalThis.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function renderBenchIndicator(val) {
  if (val === null || val === undefined) return `<span class="bench-indicator at">-</span>`;

  const cls = val >= 0 ? "above" : "below";
  const arrow = val >= 0 ? "&#9650;" : "&#9660;";

  return `<span class="bench-indicator ${cls}">${arrow} ${(val * 100).toFixed(1)}%</span>`;
}

function renderActionLabel(action) {
  if (action === "STAY") return `<span class="action-label stay">STAY</span>`;
  if (action === "CHANGE") return `<span class="action-label change">CHANGE</span>`;
  if (action === "PAUSE") return `<span class="action-label pause">PAUSE / REPLACE</span>`;
  if (action === "INACTIVE") return `<span class="action-label" style="background:#e5e7eb;color:#6b7280;">INACTIVE</span>`;

  return `<span class="action-label" style="background:#f1f5f9;color:#64748b;">N/A</span>`;
}

// ============================================
// RENDERING - PLACEMENT ANALYSIS
// ============================================
function renderPlacementAnalysis() {
  const noData = document.getElementById("placementNoData");
  const analysis = document.getElementById("placementAnalysis");

  if (!noData || !analysis) return;

  const allPlacements = [...(APP.placementGoogle || []), ...(APP.placementMeta || [])];

  if (!allPlacements.length) {
    noData.style.display = "";
    analysis.style.display = "none";
    return;
  }

  noData.style.display = "none";
  analysis.style.display = "";

  const flagsDiv = document.getElementById("placementGuardrailFlags");
  if (flagsDiv) flagsDiv.innerHTML = "";

  renderPlacementProportions(allPlacements);

  const table = document.getElementById("placementTable");
  if (!table) return;

  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  const hideMetrics = APP.hideMetrics && APP.hideMetrics.placement;

  thead.innerHTML = `<tr>
    <th>Platform</th>
    <th>Campaign</th>
    <th>Ad Group</th>
    <th>Asset Type</th>
    <th>Placement</th>
    ${hideMetrics ? "" : `
      <th class="numeric">Cost</th>
      <th class="numeric">Impr.</th>
      <th class="numeric">Clicks</th>
      <th class="numeric">CTR</th>
      <th class="numeric">Click&gt;Install%</th>
      <th class="numeric">Installs</th>
      <th class="numeric">Cost/Install</th>
      <th class="numeric">Row Share</th>
      <th class="numeric">Campaign Placement Share</th>
    `}
  </tr>`;

  tbody.innerHTML = allPlacements.sort((a, b) => b.cost - a.cost).map(p => `
    <tr>
      <td>${p.platform === "google" ? "Google Ads" : "Meta Ads"}</td>
      <td>${esc(p.campaign)}</td>
      <td>${esc(p.adGroup)}</td>
      <td>${esc(p.assetType)}</td>
      <td>${esc(p.placement)}</td>
      ${hideMetrics ? "" : `
        <td class="numeric">${fmtCurrency(p.cost)}</td>
        <td class="numeric">${fmtNum(p.impressions)}</td>
        <td class="numeric">${p.hasClicks ? fmtNum(p.clicks) : "-"}</td>
        <td class="numeric">${p.ctr !== null ? fmtPct(p.ctr) : "-"}</td>
        <td class="numeric">${p.clickToInstall !== null ? fmtPct(p.clickToInstall) : "-"}</td>
        <td class="numeric">${fmtNum(p.installs)}</td>
        <td class="numeric">${p.installs > 0 ? fmtCurrency(p.costPerInstall) : "-"}</td>
        <td class="numeric">${fmtPct(p.rowCostShare)}</td>
        <td class="numeric">${fmtPct(p.costShare)}</td>
      `}
    </tr>
  `).join("");
}

function renderPlacementProportions(placements) {
  const container = document.getElementById("placementProportions");
  if (!container) return;

  container.innerHTML = [
    renderPlacementProportionSection(
      "Placement Mix by Campaign",
      "Campaign-level view, useful for guardrail reading",
      buildPlacementMixGroups(placements, p => `${p.platform}||${p.campaign}`, p => ({
        platform: p.platform,
        title: p.campaign,
        subtitle: p.platform === "google" ? "Google Ads" : "Meta Ads"
      }))
    ),
    renderPlacementProportionSection(
      "Placement Mix by Ad Group",
      "Placement distribution inside each ad group",
      buildPlacementMixGroups(placements, p => `${p.platform}||${p.campaign}||${p.adGroup}`, p => ({
        platform: p.platform,
        title: p.adGroup,
        subtitle: `${p.platform === "google" ? "Google Ads" : "Meta Ads"} | ${p.campaign}`
      }))
    ),
    renderPlacementProportionSection(
      "Placement Mix by Asset Type",
      "Where each asset type spends across placements",
      buildPlacementMixGroups(placements, p => `${p.platform}||${p.assetType}`, p => ({
        platform: p.platform,
        title: p.assetType,
        subtitle: p.platform === "google" ? "Google Ads" : "Meta Ads"
      }))
    )
  ].join("");
}

function buildPlacementMixGroups(placements, keyFn, metaFn) {
  const groups = new Map();

  for (const p of placements) {
    const key = keyFn(p);

    if (!groups.has(key)) {
      groups.set(key, {
        ...metaFn(p),
        totalCost: 0,
        totalImpressions: 0,
        placements: new Map()
      });
    }

    const group = groups.get(key);
    group.totalCost += p.cost || 0;
    group.totalImpressions += p.impressions || 0;

    if (!group.placements.has(p.placement)) {
      group.placements.set(p.placement, {
        placement: p.placement,
        cost: 0,
        impressions: 0,
        clicks: 0,
        installs: 0
      });
    }

    const item = group.placements.get(p.placement);
    item.cost += p.cost || 0;
    item.impressions += p.impressions || 0;
    item.clicks += p.clicks || 0;
    item.installs += p.installs || 0;
  }

  return [...groups.values()].map(group => ({
    ...group,
    items: [...group.placements.values()]
      .map(item => ({
        ...item,
        costShare: safeDivide(item.cost, group.totalCost),
        ctr: safeDivide(item.clicks, item.impressions),
        cpi: safeDivide(item.cost, item.installs)
      }))
      .sort((a, b) => b.costShare - a.costShare)
  })).sort((a, b) => b.totalCost - a.totalCost);
}

function renderPlacementProportionSection(title, badge, groups) {
  if (!groups.length) return "";
  const hideMetrics = APP.hideMetrics && APP.hideMetrics.placement;

  return `
    <div class="placement-proportion-header">
      <h4>${esc(title)}</h4>
      <span class="badge">${esc(badge)}</span>
    </div>
    <div class="placement-proportion-grid">
      ${groups.map(group => {
        return `
          <div class="placement-proportion-card">
            <div class="placement-proportion-title">
              <span>${esc(group.subtitle)}</span>
              <strong>${esc(group.title)}</strong>
            </div>
            <div class="placement-share-list">
              ${group.items.map(item => `
                <div class="placement-share-row">
                  <div class="placement-share-label">
                    <span>${esc(item.placement)}</span>
                    ${hideMetrics ? "" : `<strong>${fmtPct(item.costShare)}</strong>`}
                  </div>
                  ${hideMetrics ? "" : `<div class="placement-share-bar">
                    <span style="width:${Math.min(100, Math.max(0, item.costShare * 100)).toFixed(2)}%"></span>
                  </div>
                  <div class="placement-share-meta">${fmtCurrency(item.cost)} cost | ${fmtNum(item.impressions)} impr. | ${fmtNum(item.installs)} installs</div>`}
                </div>
              `).join("")}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

// ============================================
// RENDERING - WEEK-OVER-WEEK
// ============================================
function renderWoWAnalysis() {
  const noData = document.getElementById("wowNoData");
  const analysis = document.getElementById("wowAnalysis");

  if (!noData || !analysis) return;

  if (!APP.wowResults || !APP.wowResults.length) {
    noData.style.display = "";
    analysis.style.display = "none";
    return;
  }

  noData.style.display = "none";
  analysis.style.display = "";

  const flagsDiv = document.getElementById("wowFlags");
  const allFlags = APP.wowResults.flatMap(r => r.flags.map(f => ({ flag: f, asset: r.asset, campaign: r.campaign })));

  if (flagsDiv) {
    const criticalFlags = allFlags.filter(f => f.flag.includes("Cost up") || f.flag.includes("CPI increase") || f.flag.includes("Stopped"));
    const warningFlags = allFlags.filter(f => f.flag.includes("drop") || f.flag.includes("New"));

    flagsDiv.innerHTML = [
      ...criticalFlags.map(f => `<span class="wow-flag critical">&#9888; ${esc(f.asset)}: ${esc(f.flag)}</span>`),
      ...warningFlags.map(f => `<span class="wow-flag warning">&#9888; ${esc(f.asset)}: ${esc(f.flag)}</span>`)
    ].join("");
  }

  const table = document.getElementById("wowTable");
  if (!table) return;

  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");

  thead.innerHTML = `<tr>
    <th>Platform</th>
    <th>Placement</th>
    <th>Campaign</th>
    <th>Ad Group</th>
    <th>Asset Type</th>
    <th>Asset</th>
    <th class="numeric">Cost WoW</th>
    <th class="numeric">Impr WoW</th>
    <th class="numeric">Click WoW</th>
    <th class="numeric">CTR WoW</th>
    <th class="numeric">C2I WoW</th>
    <th class="numeric">Install WoW</th>
    <th class="numeric">CPI WoW</th>
    <th>Flags</th>
  </tr>`;

  tbody.innerHTML = APP.wowResults.sort((a, b) => b.flags.length - a.flags.length).map(r => `
    <tr class="${r.flags.length > 0 ? "row-pause" : ""}">
      <td>${r.platform === "google" ? "Google" : "Meta"}</td>
      <td>${esc(r.channel || "-")}</td>
      <td>${esc(r.campaign)}</td>
      <td>${esc(r.adGroup)}</td>
      <td>${esc(r.assetType)}</td>
      <td><strong>${esc(r.asset)}</strong></td>
      <td class="numeric">${renderWoWDelta(r.wowCost)}</td>
      <td class="numeric">${renderWoWDelta(r.wowImpr)}</td>
      <td class="numeric">${renderWoWDelta(r.wowClicks)}</td>
      <td class="numeric">${renderWoWDelta(r.wowCTR)}</td>
      <td class="numeric">${renderWoWDelta(r.wowC2I)}</td>
      <td class="numeric">${renderWoWDelta(r.wowInstalls)}</td>
      <td class="numeric">${renderWoWDeltaInverse(r.wowCPI)}</td>
      <td>${r.flags.map(f => `<span class="wow-flag critical" style="font-size:0.68rem;padding:2px 6px;">${esc(f)}</span>`).join(" ")}</td>
    </tr>
  `).join("");
}

function renderWoWDelta(val) {
  if (val === null || val === undefined) return `<span class="wow-delta neutral">-</span>`;

  const cls = val >= 0 ? "positive" : "negative";
  const sign = val >= 0 ? "+" : "";

  return `<span class="wow-delta ${cls}">${sign}${(val * 100).toFixed(1)}%</span>`;
}

function renderWoWDeltaInverse(val) {
  if (val === null || val === undefined) return `<span class="wow-delta neutral">-</span>`;

  const cls = val <= 0 ? "positive" : "negative";
  const sign = val >= 0 ? "+" : "";

  return `<span class="wow-delta ${cls}">${sign}${(val * 100).toFixed(1)}%</span>`;
}

// ============================================
// RENDERING - SUMMARY
// ============================================
function renderSummary() {
  const allRows = [...APP.googleRows, ...APP.metaRows].filter(r =>
    r.week === "current" &&
    hasMeaningfulActivity({
      cost: r.cost,
      impressions: r.impressions,
      clicks: r.clicks || 0,
      installs: r.installs
    })
  );

  const execDiv = document.getElementById("execSummary");
  const typeDiv = document.getElementById("assetTypeSummaryAll");
  const actionDiv = document.getElementById("actionPlanOverview");

  if (!execDiv || !typeDiv || !actionDiv) return;

  if (!allRows.length) {
    execDiv.innerHTML = `<p class="empty-state">Generate analysis first to see the executive summary.</p>`;
    typeDiv.innerHTML = `<p class="empty-state">No data available yet.</p>`;
    actionDiv.innerHTML = `<p class="empty-state">No data available yet.</p>`;
    return;
  }

  const stayAssets = allRows.filter(r => r.actionPlan === "STAY");
  const changeAssets = allRows.filter(r => r.actionPlan === "CHANGE");
  const pauseAssets = allRows.filter(r => r.actionPlan === "PAUSE");

  const bestAsset = [...allRows].filter(r => r.installs > 0).sort((a, b) => a.costPerInstall - b.costPerInstall)[0];
  const worstAsset = [...allRows].filter(r => r.installs > 0).sort((a, b) => b.costPerInstall - a.costPerInstall)[0];

  const byType = {};

  for (const r of allRows) {
    if (!byType[r.assetType]) byType[r.assetType] = { cost: 0, installs: 0 };
    byType[r.assetType].cost += r.cost;
    byType[r.assetType].installs += r.installs;
  }

  const typePerf = Object.entries(byType)
    .map(([t, d]) => ({
      type: t,
      cpi: safeDivide(d.cost, d.installs),
      installs: d.installs
    }))
    .filter(t => t.installs > 0);

  const bestType = [...typePerf].sort((a, b) => a.cpi - b.cpi)[0];
  const worstType = [...typePerf].sort((a, b) => b.cpi - a.cpi)[0];

  const placementAbove = [...(APP.placementGoogle || []), ...(APP.placementMeta || [])]
    .filter(p => p.guardrailStatus === "Above Guardrail");

  const summaryCards = [];

  if (bestType) {
    summaryCards.push({
      cls: "highlight-good",
      title: "Best Asset Type",
      text: `${bestType.type} with CPI ${fmtCurrency(bestType.cpi)} and ${fmtNum(bestType.installs)} installs.`
    });
  }

  if (bestAsset) {
    summaryCards.push({
      cls: "highlight-good",
      title: "Best Asset",
      text: `"${bestAsset.asset}" (${bestAsset.assetType}) with CPI ${fmtCurrency(bestAsset.costPerInstall)}.`
    });
  }

  if (worstType) {
    summaryCards.push({
      cls: "highlight-bad",
      title: "Weakest Asset Type",
      text: `${worstType.type} with CPI ${fmtCurrency(worstType.cpi)}.`
    });
  }

  summaryCards.push({
    cls: "",
    title: "Action Summary",
    text: `${stayAssets.length} assets to STAY, ${changeAssets.length} to CHANGE, ${pauseAssets.length} to PAUSE/REPLACE. ${APP.inactiveRows.length} inactive/no-activity rows excluded from analysis.`
  });

  if (placementAbove.length) {
    summaryCards.push({
      cls: "highlight-bad",
      title: "Guardrail Alert",
      text: `${placementAbove.length} placement(s) above guardrail: ${placementAbove.map(p => p.campaign + " - " + p.placement).join(", ")}.`
    });
  }

  if (APP.wowResults && APP.wowResults.some(r => r.flags.length)) {
    const flagged = APP.wowResults.filter(r => r.flags.length);

    summaryCards.push({
      cls: "highlight-warn",
      title: "WoW Alerts",
      text: `${flagged.length} asset(s) with major WoW changes detected.`
    });
  }

  execDiv.innerHTML = summaryCards.map(c => `
    <div class="summary-card ${c.cls}">
      <h4>${esc(c.title)}</h4>
      <p>${esc(c.text)}</p>
    </div>
  `).join("");

  renderAssetTypeSummaryTable(typeDiv, allRows);

  actionDiv.innerHTML = `
    <div class="action-group stay-group">
      <h4><span class="action-label stay">STAY</span> ${stayAssets.length} assets</h4>
      <ul>${stayAssets.slice(0, 10).map(a => `<li>${esc(a.asset)} (${esc(a.assetType)})</li>`).join("")}${stayAssets.length > 10 ? `<li>...and ${stayAssets.length - 10} more</li>` : ""}</ul>
    </div>
    <div class="action-group change-group">
      <h4><span class="action-label change">CHANGE</span> ${changeAssets.length} assets</h4>
      <ul>${changeAssets.slice(0, 10).map(a => `<li>${esc(a.asset)} (${esc(a.assetType)})</li>`).join("")}${changeAssets.length > 10 ? `<li>...and ${changeAssets.length - 10} more</li>` : ""}</ul>
    </div>
    <div class="action-group pause-group">
      <h4><span class="action-label pause">PAUSE / REPLACE</span> ${pauseAssets.length} assets</h4>
      <ul>${pauseAssets.slice(0, 10).map(a => `<li>${esc(a.asset)} (${esc(a.assetType)})</li>`).join("")}${pauseAssets.length > 10 ? `<li>...and ${pauseAssets.length - 10} more</li>` : ""}</ul>
    </div>
  `;
}

function renderAssetTypeSummaryTable(container, allRows) {
  const byType = {};

  for (const r of allRows) {
    if (!byType[r.assetType]) byType[r.assetType] = [];
    byType[r.assetType].push(r);
  }

  const summaryRows = Object.entries(byType).map(([type, items]) => {
    const totalCost = items.reduce((s, r) => s + r.cost, 0);
    const totalImpr = items.reduce((s, r) => s + r.impressions, 0);
    const totalClicks = items.reduce((s, r) => s + (r.clicks || 0), 0);
    const totalInstalls = items.reduce((s, r) => s + r.installs, 0);

    const avgCTR = safeDivide(totalClicks, totalImpr);
    const avgC2I = safeDivide(totalInstalls, totalClicks);
    const avgCPI = safeDivide(totalCost, totalInstalls);

    const best = [...items].filter(r => r.installs > 0).sort((a, b) => a.costPerInstall - b.costPerInstall)[0];
    const worst = [...items].filter(r => r.installs > 0).sort((a, b) => b.costPerInstall - a.costPerInstall)[0];

    return {
      type,
      totalCost,
      totalImpr,
      totalClicks,
      totalInstalls,
      avgCTR,
      avgC2I,
      avgCPI,
      best,
      worst,
      count: items.length
    };
  }).sort((a, b) => b.totalCost - a.totalCost);

  container.innerHTML = `
    <div class="table-scroll">
      <table class="summary-table">
        <thead><tr>
          <th>Asset Type</th>
          <th class="numeric">Assets</th>
          <th class="numeric">Cost</th>
          <th class="numeric">Impr.</th>
          <th class="numeric">Clicks</th>
          <th class="numeric">CTR</th>
          <th class="numeric">Installs</th>
          <th class="numeric">Click&gt;Install%</th>
          <th class="numeric">CPI</th>
          <th>Best Asset</th>
          <th>Worst Asset</th>
        </tr></thead>
        <tbody>${summaryRows.map(r => `<tr>
          <td><strong>${esc(r.type)}</strong></td>
          <td class="numeric">${fmtNum(r.count)}</td>
          <td class="numeric">${fmtCurrency(r.totalCost)}</td>
          <td class="numeric">${fmtNum(r.totalImpr)}</td>
          <td class="numeric">${fmtNum(r.totalClicks)}</td>
          <td class="numeric">${fmtPct(r.avgCTR)}</td>
          <td class="numeric">${fmtNum(r.totalInstalls)}</td>
          <td class="numeric">${fmtPct(r.avgC2I)}</td>
          <td class="numeric">${r.totalInstalls > 0 ? fmtCurrency(r.avgCPI) : "-"}</td>
          <td>${r.best ? esc(r.best.asset) : "-"}</td>
          <td>${r.worst ? esc(r.worst.asset) : "-"}</td>
        </tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

// ============================================
// GUARDRAIL UI
// ============================================
function addGuardrailCampaign() {
  const container = document.getElementById("googleGuardrails");
  const template = document.getElementById("guardrailCampaignTemplate");

  if (!container || !template) return;

  const block = template.content.cloneNode(true);
  const div = block.querySelector(".guardrail-campaign-block");
  const id = crypto.randomUUID();

  div.dataset.id = id;

  const guardrail = {
    id,
    campaign: "",
    search: 70,
    gdn: 20,
    youtube: 15
  };

  APP.guardrails.google.push(guardrail);

  div.querySelector(".guardrail-campaign-name").addEventListener("input", e => {
    guardrail.campaign = e.target.value;
    runAnalysis();
  });

  div.querySelector(".g-search").addEventListener("change", e => {
    guardrail.search = Number(e.target.value) || 0;
    runAnalysis();
  });

  div.querySelector(".g-gdn").addEventListener("change", e => {
    guardrail.gdn = Number(e.target.value) || 0;
    runAnalysis();
  });

  div.querySelector(".g-youtube").addEventListener("change", e => {
    guardrail.youtube = Number(e.target.value) || 0;
    runAnalysis();
  });

  div.querySelector(".remove-guardrail-btn").addEventListener("click", () => {
    APP.guardrails.google = APP.guardrails.google.filter(g => g.id !== id);
    div.remove();
    runAnalysis();
  });

  container.appendChild(block);
}

function renderGuardrailCampaigns() {
  const container = document.getElementById("googleGuardrails");
  const template = document.getElementById("guardrailCampaignTemplate");

  if (!container || !template) return;

  container.innerHTML = "";

  for (const g of APP.guardrails.google) {
    const block = template.content.cloneNode(true);
    const div = block.querySelector(".guardrail-campaign-block");

    div.dataset.id = g.id;
    div.querySelector(".guardrail-campaign-name").value = g.campaign;
    div.querySelector(".g-search").value = g.search;
    div.querySelector(".g-gdn").value = g.gdn;
    div.querySelector(".g-youtube").value = g.youtube;

    div.querySelector(".guardrail-campaign-name").addEventListener("input", e => {
      g.campaign = e.target.value;
      runAnalysis();
    });

    div.querySelector(".g-search").addEventListener("change", e => {
      g.search = Number(e.target.value) || 0;
      runAnalysis();
    });

    div.querySelector(".g-gdn").addEventListener("change", e => {
      g.gdn = Number(e.target.value) || 0;
      runAnalysis();
    });

    div.querySelector(".g-youtube").addEventListener("change", e => {
      g.youtube = Number(e.target.value) || 0;
      runAnalysis();
    });

    div.querySelector(".remove-guardrail-btn").addEventListener("click", () => {
      APP.guardrails.google = APP.guardrails.google.filter(x => x.id !== g.id);
      div.remove();
      runAnalysis();
    });

    container.appendChild(block);
  }
}

// ============================================
// STATS
// ============================================
function updateStats() {
  const statFiles = document.getElementById("statFiles");
  const statRows = document.getElementById("statRows");
  const statAssets = document.getElementById("statAssets");

  if (statFiles) statFiles.textContent = APP.files.length;

  const totalRows = APP.files.reduce((s, f) => s + f.rows.length, 0);
  if (statRows) statRows.textContent = totalRows.toLocaleString("id-ID");

  const totalAssets =
    getCurrentActiveRows(APP.googleRows).length +
    getCurrentActiveRows(APP.metaRows).length;

  if (statAssets) statAssets.textContent = totalAssets.toLocaleString("id-ID");
}

// ============================================
// EXPORT
// ============================================
function handleExport(type) {
  let csvContent = "";
  let filename = "export.csv";

  if (type === "google") {
    csvContent = exportAnalysisCSV(getCurrentActiveRows(APP.googleRows), "google");
    filename = "google_ads_analysis.csv";
  } else if (type === "meta") {
    csvContent = exportAnalysisCSV(getCurrentActiveRows(APP.metaRows), "meta");
    filename = "meta_ads_analysis.csv";
  } else if (type === "placement") {
    csvContent = exportPlacementCSV();
    filename = "placement_analysis.csv";
  } else if (type === "wow") {
    csvContent = exportWoWCSV();
    filename = "wow_analysis.csv";
  } else if (type === "all") {
    csvContent = exportAllCSV();
    filename = "full_analysis_export.csv";
  }

  downloadCSV(csvContent, filename);
}

function exportAnalysisCSV(rows, platform = "") {
  const includeChannel = platform !== "google";
  const includeCount = platform !== "google";
  const headers = [
    ...(includeChannel ? ["Channel"] : []),
    "Campaign",
    "Ad Group",
    "Asset Type",
    "Asset",
    ...(includeCount ? ["Count"] : []),
    "Cost",
    "Impr.",
    "Clicks",
    "CTR",
    "Click>Install%",
    "Installs",
    "Cost/Install",
    "Action Plan"
  ];

  const lines = [headers.join(",")];

  for (const r of rows) {
    lines.push([
      ...(includeChannel ? [csvEscape(r.channel)] : []),
      csvEscape(r.campaign),
      csvEscape(r.adGroup),
      csvEscape(r.assetType),
      csvEscape(r.asset),
      ...(includeCount ? [r.count] : []),
      r.cost.toFixed(2),
      r.impressions,
      r.clicks || 0,
      r.ctr !== null ? (r.ctr * 100).toFixed(2) + "%" : "",
      r.clickToInstall !== null ? (r.clickToInstall * 100).toFixed(2) + "%" : "",
      r.installs,
      r.installs > 0 ? r.costPerInstall.toFixed(2) : "",
      r.actionPlan
    ].join(","));
  }

  return lines.join("\n");
}

function exportPlacementCSV() {
  const allPlacements = [...(APP.placementGoogle || []), ...(APP.placementMeta || [])];

  const headers = [
    "Platform",
    "Placement",
    "Campaign",
    "Ad Group",
    "Asset Type",
    "Placement",
    "Cost",
    "Impr.",
    "Clicks",
    "CTR",
    "Click>Install%",
    "Installs",
    "Cost/Install",
    "Row Share",
    "Campaign Placement Share"
  ];

  const lines = [headers.join(",")];

  for (const p of allPlacements) {
    lines.push([
      p.platform === "google" ? "Google Ads" : "Meta Ads",
      csvEscape(p.campaign),
      csvEscape(p.adGroup),
      csvEscape(p.assetType),
      csvEscape(p.placement),
      p.cost.toFixed(2),
      p.impressions,
      p.clicks || 0,
      p.ctr !== null ? (p.ctr * 100).toFixed(2) + "%" : "",
      p.clickToInstall !== null ? (p.clickToInstall * 100).toFixed(2) + "%" : "",
      p.installs,
      p.installs > 0 ? p.costPerInstall.toFixed(2) : "",
      (p.rowCostShare * 100).toFixed(2) + "%",
      (p.costShare * 100).toFixed(2) + "%"
    ].join(","));
  }

  return lines.join("\n");
}

function exportWoWCSV() {
  if (!APP.wowResults) return "";

  const headers = [
    "Platform",
    "Campaign",
    "Ad Group",
    "Asset Type",
    "Asset",
    "Cost WoW",
    "Impr WoW",
    "Click WoW",
    "CTR WoW",
    "C2I WoW",
    "Install WoW",
    "CPI WoW",
    "Flags"
  ];

  const lines = [headers.join(",")];

  for (const r of APP.wowResults) {
    lines.push([
      r.platform,
      csvEscape(r.channel || ""),
      csvEscape(r.campaign),
      csvEscape(r.adGroup),
      csvEscape(r.assetType),
      csvEscape(r.asset),
      r.wowCost !== null ? (r.wowCost * 100).toFixed(1) + "%" : "",
      r.wowImpr !== null ? (r.wowImpr * 100).toFixed(1) + "%" : "",
      r.wowClicks !== null ? (r.wowClicks * 100).toFixed(1) + "%" : "",
      r.wowCTR !== null ? (r.wowCTR * 100).toFixed(1) + "%" : "",
      r.wowC2I !== null ? (r.wowC2I * 100).toFixed(1) + "%" : "",
      r.wowInstalls !== null ? (r.wowInstalls * 100).toFixed(1) + "%" : "",
      r.wowCPI !== null ? (r.wowCPI * 100).toFixed(1) + "%" : "",
      csvEscape(r.flags.join("; "))
    ].join(","));
  }

  return lines.join("\n");
}

function exportInactiveCSV() {
  const headers = [
    "Platform",
    "Source File",
    "Campaign",
    "Ad Group",
    "Asset Type",
    "Asset",
    "Reason"
  ];

  const lines = [headers.join(",")];

  for (const r of APP.inactiveRows || []) {
    lines.push([
      csvEscape(r.platform),
      csvEscape(r.sourceFile),
      csvEscape(r.campaign),
      csvEscape(r.adGroup),
      csvEscape(r.assetType),
      csvEscape(r.asset),
      csvEscape(r.inactiveReason)
    ].join(","));
  }

  return lines.join("\n");
}

function exportAllCSV() {
  let content = "=== GOOGLE ADS ANALYSIS ===\n";
  content += exportAnalysisCSV(getCurrentActiveRows(APP.googleRows), "google");

  content += "\n\n=== META ADS ANALYSIS ===\n";
  content += exportAnalysisCSV(getCurrentActiveRows(APP.metaRows), "meta");

  content += "\n\n=== PLACEMENT ANALYSIS ===\n";
  content += exportPlacementCSV();

  content += "\n\n=== WEEK-OVER-WEEK ===\n";
  content += exportWoWCSV();

  content += "\n\n=== INACTIVE / NO-ACTIVITY ROWS EXCLUDED ===\n";
  content += exportInactiveCSV();

  return content;
}

function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}

function csvEscape(val) {
  const s = String(val || "");

  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return "\"" + s.replace(/"/g, "\"\"") + "\"";
  }

  return s;
}

// ============================================
// SAMPLE DATA
// ============================================
function loadSampleData() {
  clearAll();

  const googleCSV = `Asset details report
"May 10, 2026 - May 16, 2026"
segmentation_info.ad_network,Campaign,Ad group,Asset type,Asset,Clicks,CTR,Impr.,Cost,Installs,Cost / Install,Conv. rate (install)
SEARCH,Current Post Let,Jakarta Fresh Grads,Headline,Apply Now - Top Jobs,245,4.52%,"5,420","1,250,000",42,"29,762",17.14%
SEARCH,Current Post Let,Jakarta Fresh Grads,Headline,Find Your Dream Career,180,3.21%,"5,607","980,000",28,"35,000",15.56%
SEARCH,Current Post Let,Jakarta Fresh Grads,Description,Get hired in 7 days,312,5.10%,"6,118","1,450,000",55,"26,364",17.63%
SEARCH,Current Post Let,Jakarta Fresh Grads,Description,Best jobs for fresh grads,198,3.45%,"5,739","890,000",22,"40,455",11.11%
YOUTUBE,Current Post Let,Video Watchers,YouTube video,Career Growth Reel 30s,890,2.85%,"31,228","2,100,000",78,"26,923",8.76%
YOUTUBE,Current Post Let,Video Watchers,YouTube video,Office Life Vlog 15s,420,1.92%,"21,875","1,650,000",35,"47,143",8.33%
DISPLAY,Current Post Let,Retargeting,Marketing image,Blue App Screenshot,156,0.82%,"19,024","750,000",12,"62,500",7.69%
DISPLAY,Current Post Let,Retargeting,Marketing image,Job Listing Preview,234,1.12%,"20,893","920,000",18,"51,111",7.69%
SEARCH_PARTNERS,Current Post Let,Jakarta Fresh Grads,Headline,Apply Now - Top Jobs,45,2.14%,"2,103","320,000",8,"40,000",17.78%
SEARCH,tROAS,High Value Users,Headline,Premium Career Path,520,5.20%,"10,000","2,800,000",95,"29,474",18.27%
SEARCH,tROAS,High Value Users,Description,Unlock exclusive jobs,380,4.11%,"9,245","2,100,000",72,"29,167",18.95%
DISPLAY,tROAS,Broad Reach,Marketing image,Salary Calculator Banner,89,0.65%,"13,692","580,000",8,"72,500",8.99%
YOUTUBE,tROAS,Video Audience,YouTube video,Success Story Interview,650,2.41%,"26,971","1,900,000",62,"30,645",9.54%
SEARCH,tROAS,No Spend Test,Headline,Inactive Asset,0,0.00%,0,0,0,,0.00%`;

  const metaCSV = `Reporting starts,Reporting ends,Campaign name,Ad set name,Ad name,Ad delivery,Results,Cost per results,Amount spent (IDR),Impressions,Reach,Mobile app installs,Desktop app installs,Quality ranking,Engagement rate ranking,Conversion rate ranking
2026-05-10,2026-05-16,Glints Install Q2,Jakarta Young Pros,KOL Sarah Review Video,Active,45,32000,1440000,28500,22000,42,3,Above average,Above average,Above average
2026-05-10,2026-05-16,Glints Install Q2,Jakarta Young Pros,KOL Andre Testimonial,Active,28,41000,1148000,19200,15600,26,2,Average,Above average,Below average
2026-05-10,2026-05-16,Glints Install Q2,Jakarta Students,Social Media Reels Style,Active,52,28000,1456000,35000,27000,48,4,Above average,Above average,Above average
2026-05-10,2026-05-16,Glints Install Q2,Jakarta Students,Sosmed Carousel Tips,Active,18,52000,936000,14200,11800,16,2,Below average,Average,Below average
2026-05-10,2026-05-16,Glints Install Q2,Retargeting,Static Image Job Alert,Active,35,35000,1225000,22000,18000,32,3,Average,Average,Average
2026-05-10,2026-05-16,Glints Install Q2,Retargeting,Static Banner Salary,Active,15,48000,720000,12500,10200,14,1,Below average,Below average,Below average
2026-05-10,2026-05-16,Glints Install Q2,Broad Audience,Video Tiktok Style Fun,Active,62,24000,1488000,42000,33000,58,4,Above average,Above average,Above average
2026-05-10,2026-05-16,Glints Install Q2,Broad Audience,Carousel Job Listings,Active,22,45000,990000,18000,14500,20,2,Average,Average,Below average
2026-05-10,2026-05-16,Glints Install Q2,Broad Audience,Vina Post Lebaran Special,Active,38,31000,1178000,26000,21000,35,3,Above average,Above average,Average`;

  const googlePrevCSV = `Asset details report
"May 3, 2026 - May 9, 2026"
segmentation_info.ad_network,Campaign,Ad group,Asset type,Asset,Clicks,CTR,Impr.,Cost,Installs,Cost / Install,Conv. rate (install)
SEARCH,Current Post Let,Jakarta Fresh Grads,Headline,Apply Now - Top Jobs,220,4.20%,"5,238","1,150,000",38,"30,263",17.27%
SEARCH,Current Post Let,Jakarta Fresh Grads,Headline,Find Your Dream Career,195,3.50%,"5,571","1,020,000",32,"31,875",16.41%
SEARCH,Current Post Let,Jakarta Fresh Grads,Description,Get hired in 7 days,290,4.80%,"6,042","1,380,000",50,"27,600",17.24%
YOUTUBE,Current Post Let,Video Watchers,YouTube video,Career Growth Reel 30s,820,2.72%,"30,147","1,950,000",72,"27,083",8.78%
SEARCH,tROAS,High Value Users,Headline,Premium Career Path,480,4.90%,"9,796","2,600,000",88,"29,545",18.33%
YOUTUBE,tROAS,Video Audience,YouTube video,Success Story Interview,600,2.30%,"26,087","1,800,000",55,"32,727",9.17%`;

  const gParsed = parseCSVSmart(googleCSV);
  APP.files.push({
    id: crypto.randomUUID(),
    name: "sample-google-ads-week17.csv",
    platform: "google",
    week: "current",
    rawText: googleCSV,
    headers: gParsed.headers,
    rows: gParsed.rows,
    dateRange: { start: "May 10, 2026", end: "May 16, 2026" }
  });

  const mParsed = parseCSVSmart(metaCSV);
  APP.files.push({
    id: crypto.randomUUID(),
    name: "sample-meta-ads-week17.csv",
    platform: "meta",
    week: "current",
    rawText: metaCSV,
    headers: mParsed.headers,
    rows: mParsed.rows,
    dateRange: { start: "2026-05-10", end: "2026-05-16" }
  });

  const gPrevParsed = parseCSVSmart(googlePrevCSV);
  APP.files.push({
    id: crypto.randomUUID(),
    name: "sample-google-ads-week16.csv",
    platform: "google",
    week: "previous",
    rawText: googlePrevCSV,
    headers: gPrevParsed.headers,
    rows: gPrevParsed.rows,
    dateRange: { start: "May 3, 2026", end: "May 9, 2026" }
  });

  APP.guardrails.google = [
    { id: crypto.randomUUID(), campaign: "Current Post Let", search: 73.62, gdn: 12.90, youtube: 13.09 },
    { id: crypto.randomUUID(), campaign: "tROAS", search: 65, gdn: 36, youtube: 8 }
  ];

  renderFilesList();
  renderGuardrailCampaigns();
  runAnalysis();
}

// ============================================
// FORMAT HELPERS
// ============================================
function fmtCurrency(val) {
  if (!val && val !== 0) return "-";

  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    maximumFractionDigits: 2
  }).format(val);
}

function fmtNum(val) {
  if (val === null || val === undefined) return "-";
  return new Intl.NumberFormat("id-ID").format(Math.round(val));
}

function fmtPct(val) {
  if (val === null || val === undefined) return "-";
  return (val * 100).toFixed(2) + "%";
}

function esc(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
