// ============================================
// ASSET & PLACEMENT ANALYSIS - MAIN ENGINE
// Updated: exclude inactive / zero-activity rows from analysis
// ============================================

"use strict";

const DEFAULT_ASSET_ANALYSIS_CONFIG = {
  currency: {
    metaIdrToSgd: 13000
  },
  assetTypes: {
    google: ["Headline", "Description", "Horizontal Image", "Youtube Video", "HTML5"],
    meta: ["Social Media", "KOL", "Job Listing"]
  },
  guardrails: {
    google: {
      Headline: { ctr: 0, clickToInstall: 0 },
      Description: { ctr: 0, clickToInstall: 0 },
      "Horizontal Image": { ctr: 0, clickToInstall: 0 },
      "Youtube Video": { ctr: 0, clickToInstall: 0 },
      HTML5: { ctr: 0, clickToInstall: 0 }
    },
    meta: {
      KOL: { ctr: 0, clickToInstall: 0 },
      "Job Listing": { ctr: 0, clickToInstall: 0 },
      "Social Media": { ctr: 0, clickToInstall: 0 }
    }
  },
  storageKeys: {
    assetTypeOverrides: "assetTypeOverrides.v1"
  },
  uiText: {
    noCsvFiles: "No CSV files found. Drag multiple .csv files or a folder containing CSV files.",
    exportReady: "Google Sheets export is ready. Import the downloaded TSV file into Google Sheets, or paste from clipboard if your browser allowed clipboard access.",
    unreadableCsvFallback: "Please check the file format."
  }
};

const ASSET_ANALYSIS_CONFIG = mergeConfig(
  DEFAULT_ASSET_ANALYSIS_CONFIG,
  window.ASSET_ANALYSIS_CONFIG || {}
);

// ============================================
// STATE
// ============================================
const APP = {
  files: [],          // { id, name, platform, week, rawText, headers, rows, dateRange }
  googleRows: [],     // normalized + aggregated Google Ads rows
  metaRows: [],       // normalized + aggregated Meta Ads rows
  inactiveRows: [],   // rows excluded from main analysis because no meaningful activity
  actionMetricGuardrails: createDefaultActionMetricGuardrails(),
  metricFilters: {
    google: {},
    meta: {}
  },
  tableSort: {
    google: "installs",
    meta: "installs",
    placement: "cost"
  },
  assetTypeOverrides: {},
  hideMetrics: {
    google: false,
    meta: false,
    placement: false
  }
};

const NO_METRIC_VALUES_SELECTED = "__no_metric_values_selected__";
const ASSET_TYPE_OVERRIDE_STORAGE_KEY = ASSET_ANALYSIS_CONFIG.storageKeys.assetTypeOverrides;
const ASSET_TYPE_OPTIONS = ASSET_ANALYSIS_CONFIG.assetTypes.meta;
const CONTENT_TYPE_OPTIONS = ASSET_TYPE_OPTIONS;
const SUMMARY_GUARDRAIL_GROUPS = buildSummaryGuardrailGroups();

function createDefaultActionMetricGuardrails() {
  return cloneGuardrails(ASSET_ANALYSIS_CONFIG.guardrails);
}

function mergeConfig(defaults, overrides) {
  if (!isPlainObject(defaults)) return isPlainObject(overrides) ? { ...overrides } : overrides ?? defaults;
  const merged = { ...defaults };
  if (!isPlainObject(overrides)) return merged;

  for (const [key, value] of Object.entries(overrides)) {
    if (Array.isArray(value)) {
      merged[key] = [...value];
    } else if (isPlainObject(value) && isPlainObject(defaults[key])) {
      merged[key] = mergeConfig(defaults[key], value);
    } else if (value !== undefined) {
      merged[key] = value;
    }
  }

  return merged;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneGuardrails(guardrails) {
  const cloned = {};
  for (const [platform, groups] of Object.entries(guardrails || {})) {
    cloned[platform] = {};
    for (const [group, values] of Object.entries(groups || {})) {
      cloned[platform][group] = {
        ctr: Number(values?.ctr) || 0,
        clickToInstall: Number(values?.clickToInstall) || 0
      };
    }
  }
  return cloned;
}

function buildSummaryGuardrailGroups() {
  return Object.fromEntries(
    Object.entries(ASSET_ANALYSIS_CONFIG.guardrails || {}).map(([platform, groups]) => [
      platform,
      Object.keys(groups || {})
    ])
  );
}

function getMetaIdrToSgdRate() {
  return Number(ASSET_ANALYSIS_CONFIG.currency.metaIdrToSgd) ||
    DEFAULT_ASSET_ANALYSIS_CONFIG.currency.metaIdrToSgd;
}

// ============================================
// INIT
// ============================================
document.addEventListener("DOMContentLoaded", () => {
  renderConfigurableGuardrails();
  loadAssetTypeOverrides();
  wireNavTabs();
  wireUpload();
  wireActionMetricGuardrails();
  wireHideMetrics();
  wireSortControls();
  wireExport();
});

function renderConfigurableGuardrails() {
  renderGuardrailRows("googleGuardrailRows", "google");
  renderGuardrailRows("metaGuardrailRows", "meta");
}

function renderGuardrailRows(containerId, platform) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const groups = ASSET_ANALYSIS_CONFIG.guardrails[platform] || {};
  container.innerHTML = Object.entries(groups).map(([group, values]) => `
    <label class="action-guardrail-row">
      <span>${esc(group)}</span>
      <input type="number" class="guardrail-input" data-action-guardrail="${esc(platform)}.${esc(group)}.ctr" value="${formatGuardrailInputValue(values.ctr)}" min="0" step="0.01" />
      <input type="number" class="guardrail-input" data-action-guardrail="${esc(platform)}.${esc(group)}.clickToInstall" value="${formatGuardrailInputValue(values.clickToInstall)}" min="0" step="0.01" />
    </label>
  `).join("");
}

function formatGuardrailInputValue(value) {
  const percentValue = (Number(value) || 0) * 100;
  return String(Number(percentValue.toFixed(4)));
}

function loadAssetTypeOverrides() {
  try {
    const saved = localStorage.getItem(ASSET_TYPE_OVERRIDE_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : {};
    APP.assetTypeOverrides = Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, normalizeAssetTypeBucket(value)])
    );
    saveAssetTypeOverrides();
  } catch (err) {
    APP.assetTypeOverrides = {};
  }
}

function saveAssetTypeOverrides() {
  localStorage.setItem(ASSET_TYPE_OVERRIDE_STORAGE_KEY, JSON.stringify(APP.assetTypeOverrides || {}));
}

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
      const parts = e.target.dataset.actionGuardrail.split(".");
      const platform = parts[0];
      const metric = parts[parts.length - 1];
      const group = parts.slice(1, -1).join(".");

      if (!APP.actionMetricGuardrails[platform]) APP.actionMetricGuardrails[platform] = {};
      if (!APP.actionMetricGuardrails[platform][group]) APP.actionMetricGuardrails[platform][group] = { ctr: 0, clickToInstall: 0 };
      APP.actionMetricGuardrails[platform][group][metric] = (Number(e.target.value) || 0) / 100;
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

function wireSortControls() {
  document.querySelectorAll("[data-sort-table]").forEach(select => {
    const tableKey = select.dataset.sortTable;
    if (APP.tableSort[tableKey]) select.value = APP.tableSort[tableKey];
    select.addEventListener("change", e => {
      APP.tableSort[e.target.dataset.sortTable] = e.target.value;
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
  zone.addEventListener("drop", async e => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    const files = await getDroppedCSVFiles(e.dataTransfer);
    handleFiles(files);
  });

  input.addEventListener("change", () => {
    handleFiles(getCSVFiles(input.files));
    input.value = "";
  });

  if (btnSample) btnSample.addEventListener("click", loadSampleData);
  if (btnClear) btnClear.addEventListener("click", clearAll);
}

function wireExport() {
  document.querySelectorAll(".export-btn").forEach(btn => {
    btn.addEventListener("click", () => handleExport(btn.dataset.export));
  });
}

// ============================================
// FILE HANDLING
// ============================================
function getCSVFiles(fileList) {
  return Array.from(fileList || []).filter(file => isCSVFile(file));
}

function isCSVFile(file) {
  return file && (
    String(file.name || "").toLowerCase().endsWith(".csv") ||
    String(file.type || "").toLowerCase().includes("csv")
  );
}

async function getDroppedCSVFiles(dataTransfer) {
  const entries = Array.from(dataTransfer.items || [])
    .map(item => item.webkitGetAsEntry ? item.webkitGetAsEntry() : null)
    .filter(Boolean);

  if (!entries.length) return getCSVFiles(dataTransfer.files);

  const files = [];
  for (const entry of entries) {
    files.push(...await readDroppedEntryFiles(entry));
  }

  return files.filter(file => isCSVFile(file));
}

async function readDroppedEntryFiles(entry) {
  if (!entry) return [];

  if (entry.isFile) {
    return [await readDroppedFileEntry(entry)];
  }

  if (entry.isDirectory) {
    const reader = entry.createReader();
    const files = [];
    let batch = [];

    do {
      batch = await readDroppedDirectoryEntries(reader);
      for (const child of batch) {
        files.push(...await readDroppedEntryFiles(child));
      }
    } while (batch.length);

    return files;
  }

  return [];
}

function readDroppedFileEntry(entry) {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function readDroppedDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

async function handleFiles(fileList) {
  const files = getCSVFiles(fileList);
  if (!files.length) {
    alert(ASSET_ANALYSIS_CONFIG.uiText.noCsvFiles);
    return;
  }

  for (const file of files) {
    let parsedFile = null;

    try {
      parsedFile = await parseUploadedFile(file);
    } catch (err) {
      console.error(`Failed to parse ${file.name}`, err);
      alert(`Could not read ${file.name}. ${err.message || ASSET_ANALYSIS_CONFIG.uiText.unreadableCsvFallback}`);
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
      week: "current",
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
  APP.metricFilters = { google: {}, meta: {} };
  APP.tableSort = { google: "installs", meta: "installs", placement: "cost" };
  APP.assetTypeOverrides = {};
  localStorage.removeItem(ASSET_TYPE_OVERRIDE_STORAGE_KEY);
  APP.hideMetrics = { google: false, meta: false, placement: false };
  APP.actionMetricGuardrails = createDefaultActionMetricGuardrails();
  document.querySelectorAll("[data-hide-metrics]").forEach(input => { input.checked = false; });
  document.querySelectorAll("[data-action-guardrail]").forEach(input => {
    const parts = input.dataset.actionGuardrail.split(".");
    const platform = parts[0];
    const metric = parts[parts.length - 1];
    const group = parts.slice(1, -1).join(".");
    input.value = formatGuardrailInputValue(APP.actionMetricGuardrails[platform]?.[group]?.[metric]);
  });
  document.querySelectorAll("[data-sort-table]").forEach(select => {
    const tableKey = select.dataset.sortTable;
    select.value = APP.tableSort[tableKey] || select.value;
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

function cleanMetaPercentValue(val) {
  if (val === null || val === undefined || val === "") return 0;
  const raw = String(val).trim();
  if (!raw || raw === "—" || raw === "-") return 0;
  const numeric = cleanNumber(raw);
  return raw.includes("%") ? numeric : numeric / 100;
}

function cleanMetaRatioValue(val) {
  if (val === null || val === undefined || val === "") return 0;
  return cleanNumber(val);
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
    const assetLabel = asset || "Unknown Asset";
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
      contentType: applyAssetTypeOverride({
        platform: "google",
        campaign: campaign || "Unknown Campaign",
        adGroup: adGroup || "Unknown Ad Group",
        asset: assetLabel,
        inferredType: inferGoogleContentType(assetType, assetLabel)
      }),
      rawAssetType: assetType || "",
      asset: assetLabel,
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
  if (s.includes("html5") || s.includes("html 5")) return "HTML5";
  if (s.includes("youtube") || s.includes("video")) return "Youtube Video";
  if (s.includes("horizontal")) return "Horizontal Image";
  if (s.includes("image") || s.includes("banner") || s.includes("marketing image")) return "Horizontal Image";
  if (s) return raw.trim();

  return "Other";
}

function inferGoogleContentType(assetType, asset) {
  const s = `${assetType || ""} ${asset || ""}`.toLowerCase();

  if (s.includes("kol")) return "KOL";
  if (s.includes("headline") || s.includes("description") || s.includes("job") || s.includes("listing")) return "Job Listing";
  if (s.includes("youtube") || s.includes("video") || s.includes("image") || s.includes("banner") || s.includes("html5")) return "Social Media";

  return "Social Media";
}

// ============================================
// META ADS NORMALIZATION
// ============================================
function normalizeMetaAds(file) {
  const { headers, rows } = file;
  const normalized = [];
  const inactive = [];

  const rawClickHeaders = ["link clicks", "clicks (all)", "clicks", "outbound clicks"];
  const hasRawClicks = headers.some(h => rawClickHeaders.includes(h.toLowerCase().trim()));

  for (const row of rows) {
    const adName = getCol(row, headers, ["ad name"]);
    const adSetName = getCol(row, headers, ["ad set name", "adset name"]) || file.adGroupOverride || "";
    const campaign = getCol(row, headers, ["campaign name", "campaign"]) || file.campaignOverride || "";
    const assetLabel = adName || "Unknown Ad";
    const rawCost = cleanNumber(getColExact(row, headers, ['amount spent (idr)', 'amount spent', 'spent']));
    const cost = rawCost / getMetaIdrToSgdRate();
    const impressions = cleanNumber(getCol(row, headers, ["impressions"]));
    const rawCtr = cleanMetaPercentValue(getColExact(row, headers, [
      "ctr (all)",
      "ctr",
      "link ctr",
      "outbound ctr"
    ]));
    const csvClickToInstall = cleanMetaRatioValue(getColExact(row, headers, [
      "clicks to install",
      "click to install",
      "clicks>install",
      "click>install",
      "clicks>install%",
      "click>install%"
    ]));

    let clicks = 0;
    if (hasRawClicks) {
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

    if (!clicks && installs > 0 && csvClickToInstall > 0) {
      clicks = installs / csvClickToInstall;
    }

    if (!clicks && impressions > 0 && rawCtr > 0) {
      clicks = impressions * rawCtr;
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
      contentType: applyAssetTypeOverride({
        platform: "meta",
        campaign: campaign || "Unknown Campaign",
        adGroup: adSetName || "Unknown Ad Set",
        asset: assetLabel,
        inferredType: inferMetaContentType(adName)
      }),
      rawAssetType: inferMetaAssetType(adName),
      asset: assetLabel,
      cost,
      impressions,
      clicks: clicks > 0 ? clicks : null,
      installs,
      week: file.week,
      period,
      hasClicks: clicks > 0,
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

  if (s.includes("carousel")) return "Carousel";
  if (s.includes("video") || s.includes("motion") || s.includes("reels") || s.includes("tiktok")) return "Video";
  if (s.includes("image") || s.includes("static") || s.includes("banner")) return "Static Image";

  return "Ad";
}

function inferMetaContentType(adName) {
  const s = (adName || "").toLowerCase();

  if (s.includes("kol")) return "KOL";
  if (s.includes("manufacture") || s.includes("crew store") || s.includes("carousel") || s.includes("job listing") || s.includes("job")) return "Job Listing";
  if (s.includes("social") || s.includes("sosmed") || s.includes("socmed") || s.includes("tiktok style") || s.includes("reels") || s.includes("video") || s.includes("vina")) return "Social Media";

  return "Social Media";
}

function assetTypeOverrideKey({ platform, campaign, adGroup, asset }) {
  return [
    platform || "",
    campaign || "",
    adGroup || "",
    asset || ""
  ].map(part => String(part).trim().toLowerCase()).join("||");
}

function applyAssetTypeOverride({ platform, campaign, adGroup, asset, inferredType }) {
  const key = assetTypeOverrideKey({ platform, campaign, adGroup, asset });
  const override = APP.assetTypeOverrides[key];
  if (override) return normalizeAssetTypeBucket(override);

  return normalizeAssetTypeBucket(inferredType);
}

function normalizeAssetTypeBucket(value) {
  const s = String(value || "").toLowerCase().trim();

  if (s.includes("kol")) return "KOL";
  if (s.includes("job") || s.includes("listing") || s.includes("headline") || s.includes("description")) return "Job Listing";
  if (s.includes("social") || s.includes("sosmed") || s.includes("socmed") || s.includes("video") || s.includes("image") || s.includes("banner")) return "Social Media";

  return CONTENT_TYPE_OPTIONS.includes(value) ? value : "Social Media";
}

function inferFromFilename(name, type) {
  // Keep empty for now because filenames are usually not reliable enough.
  return "";
}

function applyAutoWeekAssignment(rows) {
  for (const row of rows) {
    row.week = "current";
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
    const key = `${row.week}||${row.platform}||${channel}||${row.campaign}||${row.adGroup}||${row.assetType}||${row.contentType || ""}||${row.asset}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        platform: row.platform,
        channel,
        campaign: row.campaign,
        adGroup: row.adGroup,
        assetType: row.assetType,
        contentType: row.contentType || "Social Media",
        rawAssetType: row.rawAssetType || "",
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
    if (!g.contentType && row.contentType) g.contentType = row.contentType;
    if (!g.rawAssetType && row.rawAssetType) g.rawAssetType = row.rawAssetType;
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

  const actionGuardrail = actionMetricGuardrailForRow(row);
  const ctrTarget = actionGuardrail.ctr > 0 ? actionGuardrail.ctr : bench.medianCTR;
  const c2iTarget = actionGuardrail.clickToInstall > 0 ? actionGuardrail.clickToInstall : bench.medianClickToInstall;

  if (row.ctr !== null && ctrTarget > 0) {
    const ctrAbove = row.ctr >= ctrTarget;
    const c2iAbove = row.clickToInstall !== null && c2iTarget > 0
      ? row.clickToInstall >= c2iTarget
      : true;

    return ctrAbove && c2iAbove ? "KEEP" : "CHANGE";
  }

  // Fallback when clicks/CTR unavailable.
  if (row.costPerInstall > 0 && bench.medianCPI > 0) {
    const cpiBelow = row.costPerInstall <= bench.medianCPI;
    const installsAbove = row.installs >= bench.medianInstalls;

    return cpiBelow && installsAbove ? "KEEP" : "CHANGE";
  }

  // Meta ranking fallback.
  if (row.qualityRanking || row.engagementRanking || row.conversionRanking) {
    return assignActionFromRankings(row);
  }

  return "N/A";
}

function actionMetricGuardrailForRow(row) {
  const platformGuardrails = APP.actionMetricGuardrails[row.platform] || {};
  const group = summaryGuardrailGroup(row);
  return platformGuardrails[group] || { ctr: 0, clickToInstall: 0 };
}

function assignActionFromRankings(row) {
  const quality = rankingScore(row.qualityRanking);
  const engagement = rankingScore(row.engagementRanking);
  const conversion = rankingScore(row.conversionRanking);

  if (quality >= 2 && engagement >= 2 && conversion >= 2) return "KEEP";
  if (engagement || quality || conversion) return "CHANGE";

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
  const placementOrder = ["Google Search", "YouTube", "GDN", "Search Partner"];

  for (const row of groupedRows) {
    if (row.platform !== "google") continue;
    if (!hasMeaningfulActivity({
      cost: row.cost,
      impressions: row.impressions,
      clicks: row.clicks || 0,
      installs: row.installs
    })) {
      continue;
    }

    const placement = placementOrder.includes(row.channel) ? row.channel : row.channel || "Unknown";

    if (!byPlacement.has(placement)) {
      byPlacement.set(placement, {
        platform: row.platform,
        placement,
        cost: 0,
        impressions: 0,
        clicks: 0,
        installs: 0,
        hasClicks: row.hasClicks !== false
      });
    }

    const p = byPlacement.get(placement);

    p.cost += row.cost;
    p.impressions += row.impressions;

    if (row.clicks !== null) p.clicks += row.clicks;
    else p.hasClicks = false;

    p.installs += row.installs;
  }

  const rows = placementOrder.map(placement => byPlacement.get(placement) || {
    platform: "google",
    placement,
    cost: 0,
    impressions: 0,
    clicks: 0,
    installs: 0,
    hasClicks: true
  });
  const activeRows = rows.filter(p => hasMeaningfulActivity({
    cost: p.cost,
    impressions: p.impressions,
    clicks: p.clicks || 0,
    installs: p.installs
  }));
  if (!activeRows.length) return [];
  const totalCost = activeRows.reduce((sum, p) => sum + (p.cost || 0), 0);
  const ctrBenchmark = median(activeRows.map(p => safeDivide(p.clicks, p.impressions)));
  const clickToInstallBenchmark = median(activeRows.map(p => safeDivide(p.installs, p.clicks)));

  return rows.map(p => {
    const ctr = p.hasClicks ? safeDivide(p.clicks, p.impressions) : null;
    const clickToInstall = (p.hasClicks && p.clicks > 0) ? safeDivide(p.installs, p.clicks) : null;
    const costPerInstall = safeDivide(p.cost, p.installs);

    return {
      ...p,
      ctr,
      clickToInstall,
      costPerInstall,
      costProportion: safeDivide(p.cost, totalCost),
      benchmarkStatus: placementBenchmarkStatus({ ctr, clickToInstall }, { ctr: ctrBenchmark, clickToInstall: clickToInstallBenchmark }),
      actionPlan: placementBenchmarkStatus({ ctr, clickToInstall }, { ctr: ctrBenchmark, clickToInstall: clickToInstallBenchmark }) === "Weak" ? "CHANGE" : "KEEP"
    };
  });
}

function placementBenchmarkStatus(row, benchmark) {
  const ctrRatio = benchmark.ctr > 0 && row.ctr !== null ? row.ctr / benchmark.ctr : 1;
  const c2iRatio = benchmark.clickToInstall > 0 && row.clickToInstall !== null ? row.clickToInstall / benchmark.clickToInstall : 1;
  const score = (ctrRatio + c2iRatio) / 2;

  if (score >= 1.1) return "Strong";
  if (score >= 0.8) return "Average";
  return "Weak";
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

  const currentGoogle = APP.googleRows;
  const currentGooglePlacementRows = googlePlacementRows;
  const currentMeta = APP.metaRows;

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
  renderSummary();
}

function getCurrentActiveRows(rows) {
  return rows.filter(r =>
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
    { key: "assetType", label: "Asset Type", kind: "text", get: r => r.assetType, format: String },
    { key: "contentType", label: "Content Type", kind: "text", get: r => r.contentType, format: String }
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
    keepCount: items.filter(r => r.actionPlan === "KEEP").length,
    changeCount: items.filter(r => r.actionPlan === "CHANGE").length
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
        <div class="card-metric"><span class="card-metric-label">Keep</span><span class="card-metric-value" style="color:var(--stay)">${s.keepCount}</span></div>
        <div class="card-metric"><span class="card-metric-label">Change</span><span class="card-metric-value" style="color:var(--change)">${s.changeCount}</span></div>
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
    <div class="summary-section-title">Campaign Analysis by Asset Type</div>
    ${groups.map(([campaign, items]) => renderCampaignAssetTypeSummary(campaign, items)).join("")}
  `;
}

function renderCampaignAssetTypeSummary(campaign, rows) {
  const byAssetType = {};

  for (const row of rows) {
    const key = row.assetType || "Unknown";
    if (!byAssetType[key]) byAssetType[key] = [];
    byAssetType[key].push(row);
  }

  const assetGroups = Object.entries(byAssetType)
    .sort((a, b) => b[1].reduce((s, r) => s + r.cost, 0) - a[1].reduce((s, r) => s + r.cost, 0));

  return `
    <div class="campaign-analysis-heading">
      <span>${esc(campaign)}</span>
      <small>${fmtNum(rows.length)} rows</small>
    </div>
    ${renderSummaryCard("Total", "All asset types", rows)}
    ${assetGroups.map(([assetType, items]) =>
      renderSummaryCard(assetType, `${campaign} / all ad groups`, items)
    ).join("")}
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
  const showContentTypeColumn = platform !== "google";

  thead.innerHTML = `<tr>
    ${showPlacementColumn ? renderMetricHeader(dimensionByKey.channel, rows, platform, false) : ""}
    ${renderMetricHeader(dimensionByKey.campaign, rows, platform, false)}
    ${renderMetricHeader(dimensionByKey.adGroup, rows, platform, false)}
    ${renderMetricHeader(dimensionByKey.assetType, rows, platform, false)}
    ${showContentTypeColumn ? renderMetricHeader(dimensionByKey.contentType, rows, platform, false) : ""}
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

  const sorted = sortRowsForTable(activeRows, platform);

  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="${analysisTableColspan(showPlacementColumn, showContentTypeColumn, showCountColumn, hideMetrics)}" class="empty-table-cell">No rows match the current filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = sorted.map(row => {
    const bench = benchmarks[row.benchmarkKey || benchmarkKeyForRow(row)] || {};
    const ctrVsMed = (row.ctr !== null && bench.medianCTR) ? row.ctr / bench.medianCTR - 1 : null;
    const c2iVsMed = (row.clickToInstall !== null && bench.medianClickToInstall) ? row.clickToInstall / bench.medianClickToInstall - 1 : null;
    const metricGuardrail = actionMetricGuardrailForRow(row);
    const ctrTarget = metricGuardrail.ctr > 0 ? metricGuardrail.ctr : bench.medianCTR;
    const c2iTarget = metricGuardrail.clickToInstall > 0 ? metricGuardrail.clickToInstall : bench.medianClickToInstall;

    const rowClass =
      row.actionPlan === "KEEP" ? "row-stay" :
      row.actionPlan === "CHANGE" ? "row-change" :
      "";

    return `<tr class="${rowClass}">
      ${showPlacementColumn ? `<td>${esc(row.channel)}</td>` : ""}
      <td>${esc(row.campaign)}</td>
      <td>${esc(row.adGroup)}</td>
      <td>${esc(row.assetType)}</td>
      ${showContentTypeColumn ? `<td>${renderAssetTypeOverrideInput(row)}</td>` : ""}
      <td>${renderAssetCell(row)}</td>
      ${hideMetrics ? "" : `
        ${showCountColumn ? `<td class="numeric">${fmtNum(row.count)}</td>` : ""}
        <td class="numeric">${fmtCurrency(row.cost)}</td>
        <td class="numeric">${fmtNum(row.impressions)}</td>
        <td class="numeric">${row.hasClicks !== false ? fmtNum(row.clicks) : "-"}</td>
        <td class="numeric">${renderPerformanceMetric(row.ctr, ctrTarget)}</td>
        <td class="numeric">${renderPerformanceMetric(row.clickToInstall, c2iTarget)}</td>
        <td class="numeric">${fmtNum(row.installs)}</td>
        <td class="numeric">${row.installs > 0 ? fmtCurrency(row.costPerInstall) : "-"}</td>
        <td>${renderBenchIndicator(ctrVsMed)}</td>
        <td>${renderBenchIndicator(c2iVsMed)}</td>
      `}
      <td>${renderActionLabel(row.actionPlan)}</td>
    </tr>`;
  }).join("");

  if (showContentTypeColumn) wireAssetTypeOverrideInputs(table);
  wireMetricHeaderFilters(table, platform);
}

function analysisTableColspan(showPlacementColumn, showContentTypeColumn, showCountColumn, hideMetrics) {
  const dimensionCols = (showPlacementColumn ? 1 : 0) + (showContentTypeColumn ? 1 : 0) + 4; // campaign, ad group, asset type, asset
  const metricCols = hideMetrics ? 0 : (showCountColumn ? 10 : 9);
  return dimensionCols + metricCols + 1; // action plan
}

function sortRowsForTable(rows, tableKey) {
  const sortKey = (APP.tableSort && APP.tableSort[tableKey]) || defaultSortForTable(tableKey);
  const direction = sortKey === "costPerInstall" ? "asc" : "desc";

  return [...rows].sort((a, b) => {
    const av = sortableMetricValue(a, sortKey);
    const bv = sortableMetricValue(b, sortKey);
    if (av !== bv) return direction === "asc" ? av - bv : bv - av;
    return (b.cost || 0) - (a.cost || 0);
  });
}

function defaultSortForTable(tableKey) {
  return tableKey === "placement" ? "cost" : "installs";
}

function sortableMetricValue(row, key) {
  if (key === "costPerInstall") return row.installs > 0 ? row.costPerInstall : Number.POSITIVE_INFINITY;
  if (key === "ctr" || key === "clickToInstall") return row[key] ?? -1;
  if (key === "installs") return row.installs || 0;
  return row.cost || 0;
}

function renderAssetCell(row) {
  const label = row.asset || "-";
  const url = row.assetUrl || extractAssetUrl(label);

  if (!url) return `<strong>${esc(label)}</strong>`;

  return `<a class="asset-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(label)}</strong></a>`;
}

function renderAssetTypeOverrideInput(row) {
  return `
    <select
      class="asset-type-override-input"
      data-asset-override-platform="${esc(row.platform)}"
      data-asset-override-campaign="${esc(row.campaign)}"
      data-asset-override-ad-group="${esc(row.adGroup)}"
      data-asset-override-asset="${esc(row.asset)}"
      title="Edit content type."
    >
      ${CONTENT_TYPE_OPTIONS.map(type => `<option value="${esc(type)}" ${row.contentType === type ? "selected" : ""}>${esc(type)}</option>`).join("")}
    </select>
  `;
}

function wireAssetTypeOverrideInputs(table) {
  table.querySelectorAll("[data-asset-override-asset]").forEach(input => {
    input.addEventListener("change", e => {
      const target = e.target;
      const key = assetTypeOverrideKey({
        platform: target.dataset.assetOverridePlatform,
        campaign: target.dataset.assetOverrideCampaign,
        adGroup: target.dataset.assetOverrideAdGroup,
        asset: target.dataset.assetOverrideAsset
      });
      const value = target.value.trim();

      if (value) APP.assetTypeOverrides[key] = normalizeAssetTypeBucket(value);
      else delete APP.assetTypeOverrides[key];

      saveAssetTypeOverrides();
      runAnalysis();
    });
  });
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

function renderPerformanceMetric(value, target) {
  if (value === null || value === undefined) return "-";
  if (!target || target <= 0) return fmtPct(value);

  const cls = value >= target ? "metric-good" : "metric-bad";
  return `<span class="${cls}">${fmtPct(value)}</span>`;
}

function renderActionLabel(action) {
  if (action === "KEEP") return `<span class="action-label stay">KEEP</span>`;
  if (action === "CHANGE") return `<span class="action-label change">CHANGE</span>`;
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

  const allPlacements = APP.placementGoogle || [];

  if (!allPlacements.length) {
    noData.style.display = "";
    analysis.style.display = "none";
    return;
  }

  noData.style.display = "none";
  analysis.style.display = "";

  const table = document.getElementById("placementTable");
  if (!table) return;

  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  const hideMetrics = APP.hideMetrics && APP.hideMetrics.placement;

  thead.innerHTML = `<tr>
    <th>Placement</th>
    ${hideMetrics ? "" : `
      <th class="numeric">Cost</th>
      <th class="numeric">Budget Proportion</th>
      <th class="numeric">Install</th>
      <th class="numeric">CTR</th>
      <th class="numeric">CPI</th>
      <th class="numeric">Click to Install</th>
      <th>Benchmark</th>
      <th>Action Plan</th>
    `}
  </tr>`;

  tbody.innerHTML = sortRowsForTable(allPlacements, "placement").map(p => `
    <tr class="${p.actionPlan === "CHANGE" ? "row-change" : "row-stay"}">
      <td>${esc(p.placement)}</td>
      ${hideMetrics ? "" : `
        <td class="numeric">${fmtCurrency(p.cost)}</td>
        <td class="numeric">${fmtPct(p.costProportion)}</td>
        <td class="numeric">${fmtNum(p.installs)}</td>
        <td class="numeric">${p.ctr !== null ? fmtPct(p.ctr) : "-"}</td>
        <td class="numeric">${p.installs > 0 ? fmtCurrency(p.costPerInstall) : "-"}</td>
        <td class="numeric">${p.clickToInstall !== null ? fmtPct(p.clickToInstall) : "-"}</td>
        <td>${renderBenchmarkLabel(p.benchmarkStatus)}</td>
        <td>${renderActionLabel(p.actionPlan)}</td>
      `}
    </tr>
  `).join("");
}

function renderBenchmarkLabel(status) {
  const cls = status === "Strong" ? "stay" : status === "Weak" ? "change" : "";
  return `<span class="action-label ${cls}">${esc(status || "Average")}</span>`;
}

// ============================================
// RENDERING - SUMMARY
// ============================================
function renderSummary() {
  const allRows = [...APP.googleRows, ...APP.metaRows].filter(r =>
    hasMeaningfulActivity({
      cost: r.cost,
      impressions: r.impressions,
      clicks: r.clicks || 0,
      installs: r.installs
    })
  );

  const execDiv = document.getElementById("execSummary");
  const typeDiv = document.getElementById("assetTypeSummaryAll");

  if (!execDiv || !typeDiv) return;

  if (!allRows.length) {
    execDiv.innerHTML = "";
    typeDiv.innerHTML = `<p class="empty-state">No data available yet.</p>`;
    return;
  }

  execDiv.innerHTML = "";
  renderAssetTypeSummaryTable(typeDiv, allRows);
}

function buildSummaryGuardrailRows(rows, platform) {
  const groups = SUMMARY_GUARDRAIL_GROUPS[platform] || [];
  const byGroup = new Map();

  for (const row of rows) {
    const group = summaryGuardrailGroup(row);
    if (!groups.includes(group)) continue;
    if (!byGroup.has(group)) {
      byGroup.set(group, {
        platform,
        group,
        cost: 0,
        impressions: 0,
        clicks: 0,
        installs: 0,
        count: 0
      });
    }

    const item = byGroup.get(group);
    item.cost += row.cost || 0;
    item.impressions += row.impressions || 0;
    item.clicks += row.clicks || 0;
    item.installs += row.installs || 0;
    item.count += row.count || 1;
  }

  const aggregated = groups
    .map(group => byGroup.get(group))
    .filter(Boolean)
    .map(item => ({
      ...item,
      ctr: safeDivide(item.clicks, item.impressions),
      clickToInstall: safeDivide(item.installs, item.clicks)
    }));

  if (!aggregated.length) return [];

  return aggregated.map(item => {
    const actionGuardrail = actionMetricGuardrailForGroup(platform, item.group);
    const ctrBenchmark = actionGuardrail.ctr || 0;
    const clickToInstallBenchmark = actionGuardrail.clickToInstall || 0;
    const underCTR = ctrBenchmark > 0 && item.ctr < ctrBenchmark;
    const underClickToInstall = clickToInstallBenchmark > 0 && item.clickToInstall < clickToInstallBenchmark;

    return {
      ...item,
      ctrBenchmark,
      clickToInstallBenchmark,
      underCTR,
      underClickToInstall,
      flagged: underCTR || underClickToInstall
    };
  });
}

function actionMetricGuardrailForGroup(platform, group) {
  return (APP.actionMetricGuardrails[platform] && APP.actionMetricGuardrails[platform][group]) || { ctr: 0, clickToInstall: 0 };
}

function summaryGuardrailGroup(row) {
  if (row.platform === "google") {
    return normalizeSummaryGuardrailGroup(row.assetType || row.contentType || "");
  }

  return normalizeSummaryGuardrailGroup(row.contentType || row.assetType || "");
}

function normalizeSummaryGuardrailGroup(value) {
  const s = String(value || "").toLowerCase();

  if (s.includes("headline")) return "Headline";
  if (s.includes("description")) return "Description";
  if (s.includes("horizontal") || s.includes("image")) return "Horizontal Image";
  if (s.includes("youtube") || s.includes("video")) return "Youtube Video";
  if (s.includes("html5") || s.includes("html 5")) return "HTML5";
  if (s.includes("kol")) return "KOL";
  if (s.includes("job") || s.includes("listing")) return "Job Listing";
  if (s.includes("social") || s.includes("sosmed") || s.includes("socmed")) return "Social Media";

  return String(value || "").trim();
}

function renderSummarySignalLabel(row) {
  if (!row.flagged) return `<span class="action-label stay">OK</span>`;

  const reasons = [];
  if (row.underCTR) reasons.push("CTR under");
  if (row.underClickToInstall) reasons.push("Click>Install under");

  return `<span class="action-label change">FLAG</span><span class="signal-reason">${esc(reasons.join(", "))}</span>`;
}

function renderAssetTypeSummaryTable(container, allRows) {
  const summaryRows = [
    ...buildSummaryGuardrailRows(allRows.filter(r => r.platform === "google"), "google"),
    ...buildSummaryGuardrailRows(allRows.filter(r => r.platform === "meta"), "meta")
  ].filter(row => !isAppInstallIOSGroup(row.group)).sort((a, b) => {
    if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
    return b.cost - a.cost;
  });
  const costByPlatform = summaryRows.reduce((map, row) => {
    map[row.platform] = (map[row.platform] || 0) + row.cost;
    return map;
  }, {});

  container.innerHTML = `
    <div class="table-scroll">
      <table class="summary-table">
        <thead><tr>
          <th>Platform</th>
          <th>Guardrail</th>
          <th class="numeric">Assets</th>
          <th class="numeric">Cost</th>
          <th class="numeric">Budget Proportion</th>
          <th class="numeric">Clicks</th>
          <th class="numeric">CTR</th>
          <th class="numeric">Installs</th>
          <th class="numeric">Click&gt;Install%</th>
          <th class="numeric">CPI</th>
          <th>Signal</th>
        </tr></thead>
        <tbody>${summaryRows.map(r => `<tr class="${r.flagged ? "row-change" : "row-stay"}">
          <td>${r.platform === "google" ? "Google Ads" : "Meta Ads"}</td>
          <td><strong>${esc(r.group)}</strong></td>
          <td class="numeric">${fmtNum(r.count)}</td>
          <td class="numeric">${fmtCurrency(r.cost)}</td>
          <td class="numeric">${fmtPct(safeDivide(r.cost, costByPlatform[r.platform]))}</td>
          <td class="numeric">${fmtNum(r.clicks)}</td>
          <td class="numeric">${fmtPct(r.ctr)}</td>
          <td class="numeric">${fmtNum(r.installs)}</td>
          <td class="numeric">${fmtPct(r.clickToInstall)}</td>
          <td class="numeric">${r.installs > 0 ? fmtCurrency(safeDivide(r.cost, r.installs)) : "-"}</td>
          <td>${renderSummarySignalLabel(r)}</td>
        </tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function isAppInstallIOSGroup(value) {
  const s = String(value || "").toLowerCase();
  return s.includes("app install") && s.includes("ios");
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
  let sheetContent = "";
  let filename = "export_for_google_sheets.tsv";

  if (type === "google") {
    sheetContent = exportAnalysisSheet(getCurrentActiveRows(APP.googleRows), "google");
    filename = "google_ads_analysis_for_sheets.tsv";
  } else if (type === "meta") {
    sheetContent = exportAnalysisSheet(getCurrentActiveRows(APP.metaRows), "meta");
    filename = "meta_ads_analysis_for_sheets.tsv";
  } else if (type === "placement") {
    sheetContent = exportPlacementSheet();
    filename = "google_placement_analysis_for_sheets.tsv";
  }

  exportToGoogleSheets(sheetContent, filename);
}

function exportAnalysisSheet(rows, platform = "") {
  const includeChannel = platform !== "google";
  const includeCount = platform !== "google";
  const includeContentType = platform !== "google";
  const headers = [
    ...(includeChannel ? ["Channel"] : []),
    "Campaign",
    "Ad Group",
    "Asset Type",
    ...(includeContentType ? ["Content Type"] : []),
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

  const lines = [headers.map(sheetEscape).join("\t")];

  for (const r of rows) {
    lines.push([
      ...(includeChannel ? [r.channel] : []),
      r.campaign,
      r.adGroup,
      r.assetType,
      ...(includeContentType ? [r.contentType || ""] : []),
      r.asset,
      ...(includeCount ? [r.count] : []),
      r.cost.toFixed(2),
      r.impressions,
      r.clicks || 0,
      r.ctr !== null ? (r.ctr * 100).toFixed(2) + "%" : "",
      r.clickToInstall !== null ? (r.clickToInstall * 100).toFixed(2) + "%" : "",
      r.installs,
      r.installs > 0 ? r.costPerInstall.toFixed(2) : "",
      r.actionPlan
    ].map(sheetEscape).join("\t"));
  }

  return lines.join("\n");
}

function exportPlacementSheet() {
  const headers = [
    "Placement",
    "Cost",
    "Budget Proportion",
    "Install",
    "CTR",
    "CPI",
    "Click to Install",
    "Benchmark",
    "Action Plan"
  ];

  const lines = [headers.map(sheetEscape).join("\t")];

  for (const p of sortRowsForTable(APP.placementGoogle || [], "placement")) {
    lines.push([
      p.placement,
      p.cost.toFixed(2),
      (p.costProportion * 100).toFixed(2) + "%",
      p.installs,
      p.ctr !== null ? (p.ctr * 100).toFixed(2) + "%" : "",
      p.installs > 0 ? p.costPerInstall.toFixed(2) : "",
      p.clickToInstall !== null ? (p.clickToInstall * 100).toFixed(2) + "%" : "",
      p.benchmarkStatus,
      p.actionPlan
    ].map(sheetEscape).join("\t"));
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
    "Content Type",
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
      csvEscape(r.contentType || ""),
      csvEscape(r.asset),
      csvEscape(r.inactiveReason)
    ].join(","));
  }

  return lines.join("\n");
}

function exportToGoogleSheets(content, filename) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(content).catch(() => {});
  }

  const blob = new Blob([content], { type: "text/tab-separated-values;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);

  alert(ASSET_ANALYSIS_CONFIG.uiText.exportReady);
}

function sheetEscape(val) {
  const s = String(val ?? "");
  return /[\t\r\n"]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
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

  renderFilesList();
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
