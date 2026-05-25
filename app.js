const METRIC_FIELDS = [
  "campaign",
  "adGroup",
  "appAssetType",
  "appAsset",
  "count",
  "cost",
  "impressions",
  "clicks",
  "ctr",
  "installs",
];

const FRIENDLY_FIELD_NAMES = {
  campaign: "Campaign",
  adGroup: "Ad group",
  appAssetType: "App asset type",
  appAsset: "App asset",
  count: "Count",
  cost: "Cost",
  impressions: "Impr.",
  clicks: "Clicks",
  ctr: "CTR",
  installs: "Installs",
};

const SOURCE_LABELS = {
  google_ads: "Google Ads",
};

const state = {
  datasets: [],
  normalizedRows: [],
  referenceDate: null,
};

const nodes = {
  referenceDatetime: document.getElementById("referenceDatetime"),
  referenceSummary: document.getElementById("referenceSummary"),
  timezoneLabel: document.getElementById("timezoneLabel"),
  datasetContainer: document.getElementById("datasetContainer"),
  datasetOverview: document.getElementById("datasetOverview"),
  datasetCount: document.getElementById("datasetCount"),
  rowCount: document.getElementById("rowCount"),
  campaignCount: document.getElementById("campaignCount"),
  campaignSearch: document.getElementById("campaignSearch"),
  sortBy: document.getElementById("sortBy"),
  totalSpendCard: document.getElementById("totalSpendCard"),
  totalInstallsCard: document.getElementById("totalInstallsCard"),
  avgCpiCard: document.getElementById("avgCpiCard"),
  flaggedCountCard: document.getElementById("flaggedCountCard"),
  analysisSummary: document.getElementById("analysisSummary"),
  campaignTable: document.getElementById("campaignTable"),
  loadSampleBtn: document.getElementById("loadSampleBtn"),
  clearAllBtn: document.getElementById("clearAllBtn"),
};

init();

function init() {
  setDefaultReferenceDate();
  wireEvents();
  if (!state.datasets.length) {
    loadSampleData({ auto: true });
    return;
  }
  renderAll();
}

function wireEvents() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  document.querySelectorAll(".file-input").forEach((input) => {
    input.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const source = event.target.dataset.source;
      await handleFileUpload(file, source);
      event.target.value = "";
    });
  });

  [
    nodes.referenceDatetime,
    nodes.timezoneLabel,
    nodes.campaignSearch,
    nodes.sortBy,
  ].filter(Boolean).forEach((node) => node.addEventListener("input", renderAll));

  nodes.loadSampleBtn.addEventListener("click", loadSampleData);
  nodes.clearAllBtn.addEventListener("click", clearAllData);
}

function switchTab(tabId) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabId);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabId);
  });
}

function setDefaultReferenceDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  nodes.referenceDatetime.value = local.toISOString().slice(0, 16);
}

async function handleFileUpload(file, source) {
  if (state.datasets.length && state.datasets.every((dataset) => dataset.isSample)) {
    state.datasets = [];
  }

  const rawText = await file.text();
  const rows = parseCsv(rawText);
  if (!rows.length) return;

  const headers = rows[0];
  const body = rows.slice(1).filter((row) => row.some((value) => String(value).trim() !== ""));
  const mapping = guessMapping(headers);
  const dataset = {
    id: crypto.randomUUID(),
    source,
    fileName: file.name,
    headers,
    body,
    mapping,
    isSample: false,
  };

  state.datasets.push(dataset);
  renderDatasets();
  rebuildNormalizedRows();
  renderAll();
}

function guessMapping(headers) {
  const mapping = {};
  const lower = headers.map((header) => header.trim().toLowerCase());
  const find = (patterns) => {
    const idx = lower.findIndex((header) => patterns.some((pattern) => header.includes(pattern)));
    return idx >= 0 ? headers[idx] : "";
  };
  const findExact = (patterns) => {
    const idx = lower.findIndex((header) => patterns.some((pattern) => header === pattern));
    return idx >= 0 ? headers[idx] : "";
  };

  mapping.campaign = find(["campaign name", "campaign"]);
  mapping.adGroup = find(["ad group", "adgroup"]);
  mapping.appAssetType = findExact(["app asset type", "asset type"]) || find(["app asset type", "asset type"]);
  mapping.appAsset = findExact(["app asset", "asset"]) || find(["app asset", "asset"]);
  mapping.count = find(["count"]);
  mapping.cost = find(["cost"]);
  mapping.impressions = find(["impr.", "impr", "impression"]);
  mapping.clicks = find(["click"]);
  mapping.ctr = find(["ctr"]);
  mapping.installs = find(["install", "conversion"]);
  return mapping;
}

function renderDatasets() {
  renderDatasetOverview();
  nodes.datasetContainer.innerHTML = "";
  if (!state.datasets.length) return;

  const template = document.getElementById("datasetTemplate");
  state.datasets.forEach((dataset) => {
    const fragment = template.content.cloneNode(true);
    fragment.querySelector(".dataset-title").textContent = `${SOURCE_LABELS[dataset.source]} · ${dataset.fileName}`;
    fragment.querySelector(".dataset-meta").textContent = `${dataset.body.length.toLocaleString()} rows · ${dataset.headers.length} columns`;
    fragment.querySelector(".mapped-summary").textContent = buildMappedSummary(dataset);

    const badges = fragment.querySelector(".dataset-badges");
    badges.innerHTML = `
      <span class="dataset-badge">${escapeHtml(dataset.source)}</span>
      ${dataset.isSample ? `<span class="dataset-badge sample">sample data</span>` : ""}
    `;

    const removeButton = fragment.querySelector(".remove-dataset-btn");
    removeButton.addEventListener("click", () => {
      state.datasets = state.datasets.filter((item) => item.id !== dataset.id);
      renderDatasets();
      rebuildNormalizedRows();
      renderAll();
    });

    const previewWrap = fragment.querySelector(".preview-wrap");
    const previewButton = fragment.querySelector(".preview-toggle-btn");
    previewButton.addEventListener("click", () => {
      const hidden = previewWrap.classList.toggle("hidden");
      previewButton.textContent = hidden ? "Show preview" : "Hide preview";
    });

    renderPreviewTable(fragment.querySelector(".preview-table"), dataset);

    const mappingGrid = fragment.querySelector(".mapping-grid");
    METRIC_FIELDS.forEach((field) => {
      const group = document.createElement("div");
      group.className = "mapping-group";
      const label = document.createElement("label");
      label.textContent = FRIENDLY_FIELD_NAMES[field];
      const select = document.createElement("select");
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "Not provided";
      select.appendChild(emptyOption);
      dataset.headers.forEach((header) => {
        const option = document.createElement("option");
        option.value = header;
        option.textContent = header;
        option.selected = dataset.mapping[field] === header;
        select.appendChild(option);
      });
      select.addEventListener("change", (event) => {
        dataset.mapping[field] = event.target.value;
        rebuildNormalizedRows();
        renderAll();
      });
      group.append(label, select);
      mappingGrid.appendChild(group);
    });

    nodes.datasetContainer.appendChild(fragment);
  });
}

function rebuildNormalizedRows() {
  const normalized = [];
  state.datasets.forEach((dataset) => {
    const headerIndex = Object.fromEntries(dataset.headers.map((header, index) => [header, index]));
    dataset.body.forEach((row) => {
      const item = {
        source: dataset.source,
        campaign: cleanText(readMappedValue(row, dataset.mapping.campaign, headerIndex)),
        adGroup: cleanText(readMappedValue(row, dataset.mapping.adGroup, headerIndex)),
        appAssetType: cleanText(readMappedValue(row, dataset.mapping.appAssetType, headerIndex)),
        appAsset: cleanText(readMappedValue(row, dataset.mapping.appAsset, headerIndex)),
        count: parseMetricValue(readMappedValue(row, dataset.mapping.count, headerIndex)),
        cost: parseMetricValue(readMappedValue(row, dataset.mapping.cost, headerIndex)),
        impressions: parseMetricValue(readMappedValue(row, dataset.mapping.impressions, headerIndex)),
        clicks: parseMetricValue(readMappedValue(row, dataset.mapping.clicks, headerIndex)),
        ctr: parseMetricValue(readMappedValue(row, dataset.mapping.ctr, headerIndex)),
        installs: parseMetricValue(readMappedValue(row, dataset.mapping.installs, headerIndex)),
      };

      if (!item.campaign && !item.adGroup && !item.appAsset) return;
      if (!item.campaign) item.campaign = "Google Ads";
      if (!item.adGroup) item.adGroup = "Unmapped ad group";
      if (!item.appAssetType) item.appAssetType = "Unmapped asset type";
      if (!item.appAsset) item.appAsset = "Unmapped app asset";
      normalized.push(item);
    });
  });

  state.normalizedRows = normalized;
}

function renderDatasetOverview() {
  if (!state.datasets.length) {
    nodes.datasetOverview.innerHTML = `
      <div class="section-title">
        <h2>Loaded Data</h2>
        <span class="badge">0 datasets</span>
      </div>
      <p class="muted">No files loaded yet. Use sample data or upload your own CSV exports.</p>
    `;
    return;
  }

  nodes.datasetOverview.innerHTML = `
    <div class="section-title">
      <h2>Loaded Data</h2>
      <span class="badge">${state.datasets.length} datasets</span>
    </div>
    <div class="overview-list">
      ${state.datasets
        .map(
          (dataset) => `
            <div class="overview-item">
              <div>
                <strong>${escapeHtml(dataset.fileName)}</strong>
                <span class="muted small">${SOURCE_LABELS[dataset.source]} · ${dataset.body.length.toLocaleString()} rows${dataset.isSample ? " · sample" : ""}</span>
              </div>
              <span class="muted small">${escapeHtml(buildMappedSummary(dataset))}</span>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderAll() {
  state.referenceDate = parseReferenceDate();
  renderReferenceSummary();
  renderGlobalCounts();
  renderCampaignMonitor();
  renderDiagnostics();
}

function parseReferenceDate() {
  const raw = nodes.referenceDatetime.value;
  return raw ? new Date(raw) : new Date();
}

function renderReferenceSummary() {
  const ref = state.referenceDate;
  nodes.referenceSummary.textContent = `${nodes.timezoneLabel.value}: ${formatDateTime(ref)}`;
}

function renderGlobalCounts() {
  const assets = new Set(state.normalizedRows.map((row) => `${row.campaign}__${row.adGroup}__${row.appAssetType}__${row.appAsset}`));
  nodes.datasetCount.textContent = String(state.datasets.length);
  nodes.rowCount.textContent = state.normalizedRows.length.toLocaleString();
  nodes.campaignCount.textContent = assets.size.toLocaleString();
}

function renderCampaignMonitor() {
  const table = nodes.campaignTable;
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  tbody.innerHTML = "";

  thead.innerHTML = `
    <tr>
      <th>Campaign</th>
      <th>Ad group</th>
      <th>App asset type</th>
      <th>App asset</th>
      <th>Count</th>
      <th>Cost</th>
      <th>Impr.</th>
      <th>Clicks</th>
      <th>CTR</th>
      <th>Clicks&gt;Install%</th>
      <th>Installs</th>
      <th>Cost / Install</th>
    </tr>
  `;

  if (!state.normalizedRows.length) {
    tbody.innerHTML = `<tr><td colspan="12" class="empty">Upload and map at least one Google Ads CSV first.</td></tr>`;
    renderCampaignCards([]);
    renderAnalysisSummary([]);
    return;
  }

  const summaries = buildAssetSummaries();
  if (!summaries.length) {
    tbody.innerHTML = `<tr><td colspan="12" class="empty">No asset rows match the current filters.</td></tr>`;
    renderCampaignCards([]);
    renderAnalysisSummary([]);
    return;
  }

  summaries.forEach((summary) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(summary.campaign)}</td>
      <td>${escapeHtml(summary.adGroup)}</td>
      <td>${escapeHtml(summary.appAssetType)}</td>
      <td><span class="campaign-name">${escapeHtml(summary.appAsset)}</span></td>
      <td>${formatNumber(summary.count)}</td>
      <td>${formatCurrency(summary.cost)}</td>
      <td>${formatNumber(summary.impressions)}</td>
      <td>${formatNumber(summary.clicks)}</td>
      <td>${formatPercent(summary.ctr)}</td>
      <td>${formatPercent(summary.clickToInstall)}</td>
      <td>${formatNumber(summary.installs)}</td>
      <td>${formatCostPerInstall(summary)}</td>
    `;
    tbody.appendChild(row);
  });

  renderCampaignCards(summaries);
  renderAnalysisSummary(summaries);
}

function buildAssetSummaries() {
  const search = nodes.campaignSearch.value.trim().toLowerCase();
  const grouped = new Map();
  state.normalizedRows.forEach((row) => {
    const searchable = `${row.campaign} ${row.adGroup} ${row.appAssetType} ${row.appAsset}`.toLowerCase();
    if (search && !searchable.includes(search)) return;
    const key = `${row.campaign}__${row.adGroup}__${row.appAssetType}__${row.appAsset}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        campaign: row.campaign,
        adGroup: row.adGroup,
        appAssetType: row.appAssetType,
        appAsset: row.appAsset,
        count: 0,
        cost: 0,
        impressions: 0,
        clicks: 0,
        ctrTotal: 0,
        ctrRows: 0,
        installs: 0,
      });
    }
    const bucket = grouped.get(key);
    bucket.count += row.count || 0;
    bucket.cost += row.cost || 0;
    bucket.impressions += row.impressions || 0;
    bucket.clicks += row.clicks || 0;
    bucket.installs += row.installs || 0;
    if (row.ctr > 0) {
      bucket.ctrTotal += row.ctr;
      bucket.ctrRows += 1;
    }
  });

  const summaries = Array.from(grouped.values()).map((item) => ({
    ...item,
    ctr: item.ctrRows ? item.ctrTotal / item.ctrRows : safeDivide(item.clicks, item.impressions),
    clickToInstall: safeDivide(item.installs, item.clicks),
    costPerInstall: safeDivide(item.cost, item.installs),
  }));

  const sortBy = nodes.sortBy.value;
  summaries.sort((left, right) => (right[sortBy] || 0) - (left[sortBy] || 0));
  return summaries;
}

function renderCampaignCards(summaries) {
  const totalCost = sum(summaries.map((item) => item.cost));
  const totalInstalls = sum(summaries.map((item) => item.installs));
  const avgCostPerInstall = safeDivide(totalCost, totalInstalls);
  const totalClicks = sum(summaries.map((item) => item.clicks));

  nodes.totalSpendCard.textContent = formatCurrency(totalCost);
  nodes.totalInstallsCard.textContent = formatNumber(totalInstalls);
  nodes.avgCpiCard.textContent = formatCurrency(avgCostPerInstall);
  nodes.flaggedCountCard.textContent = formatNumber(totalClicks);
}

function renderAnalysisSummary(summaries) {
  if (!summaries.length) {
    nodes.analysisSummary.innerHTML = `
      <div class="analysis-card">
        <h3>No analysis yet</h3>
        <p>Upload a Google Ads CSV or use sample data first. The dashboard will flag strong assets, weak assets, and budget risks automatically.</p>
      </div>
    `;
    return;
  }

  const validInstallCost = summaries.filter((item) => item.installs > 0);
  const bestEfficiency = [...validInstallCost].sort((left, right) => left.costPerInstall - right.costPerInstall)[0];
  const worstEfficiency = [...validInstallCost].sort((left, right) => right.costPerInstall - left.costPerInstall)[0];
  const bestConversion = [...summaries].sort((left, right) => right.clickToInstall - left.clickToInstall)[0];
  const weakSpend = [...summaries]
    .filter((item) => item.cost > 0)
    .sort((left, right) => {
      if (left.installs === 0 && right.installs === 0) return right.cost - left.cost;
      if (left.installs === 0) return -1;
      if (right.installs === 0) return 1;
      return right.costPerInstall - left.costPerInstall;
    })[0];
  const lowCtr = [...summaries].filter((item) => item.impressions > 0).sort((left, right) => left.ctr - right.ctr)[0];

  const insights = [];
  if (bestEfficiency) {
    insights.push({
      title: "Good asset",
      body: `${bestEfficiency.appAsset} has the lowest Cost / Install at ${formatCurrency(bestEfficiency.costPerInstall)} from ${formatNumber(bestEfficiency.installs)} installs.`,
    });
  }
  if (worstEfficiency) {
    insights.push({
      title: "Weak efficiency",
      body: `${worstEfficiency.appAsset} has the highest Cost / Install at ${formatCurrency(worstEfficiency.costPerInstall)}. Review targeting, asset quality, or pause if volume is not strategic.`,
    });
  }
  if (bestConversion) {
    insights.push({
      title: "Best click quality",
      body: `${bestConversion.appAsset} has the strongest Clicks>Install% at ${formatPercent(bestConversion.clickToInstall)}.`,
    });
  }
  if (weakSpend) {
    insights.push({
      title: "Spend risk",
      body: `${weakSpend.appAsset} spent ${formatCurrency(weakSpend.cost)} with ${formatNumber(weakSpend.installs)} installs. This is the first row to inspect for wasted budget.`,
    });
  }
  if (lowCtr) {
    insights.push({
      title: "Creative watchout",
      body: `${lowCtr.appAsset} has the lowest CTR at ${formatPercent(lowCtr.ctr)} from ${formatNumber(lowCtr.impressions)} impressions.`,
    });
  }

  nodes.analysisSummary.innerHTML = insights
    .map(
      (item) => `
        <div class="analysis-card">
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.body)}</p>
        </div>
      `
    )
    .join("");
}

function renderDiagnostics() {
  return;
}

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current.length || row.length) {
    row.push(current);
    rows.push(row);
  }

  return rows.map((line) => line.map((value) => value.trim()));
}

function readMappedValue(row, header, headerIndex) {
  if (!header || !(header in headerIndex)) return "";
  return row[headerIndex[header]] ?? "";
}

function normalizeDate(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
    const [month, day, year] = raw.split("/");
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return isoDate(parsed);
}

function normalizeHour(value) {
  const raw = cleanText(value);
  if (!raw) return null;
  const maybeInt = Number(raw.replace(/[^\d]/g, ""));
  if (!Number.isFinite(maybeInt)) return null;
  return Math.max(0, Math.min(23, maybeInt));
}

function parseMetricValue(value) {
  const raw = cleanText(value);
  if (!raw) return 0;
  let cleaned = raw.replace(/[^\d.,-]/g, "");
  if (cleaned.includes(".") && cleaned.includes(",")) {
    cleaned = cleaned.replace(/,/g, "");
  } else if (cleaned.includes(",") && !cleaned.includes(".")) {
    cleaned = cleaned.replace(/,/g, "");
  } else if (!raw.includes("%") && /^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, "");
  }
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) return 0;
  if (raw.includes("%")) return numeric / 100;
  return numeric;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function formatDateTime(date) {
  return `${isoDate(date)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function isoDate(date) {
  const target = typeof date === "string" ? new Date(date) : date;
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDate(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

function getElapsedFraction(referenceDate) {
  const minutes = referenceDate.getHours() * 60 + referenceDate.getMinutes();
  return Math.min(1, Math.max(0, minutes / (24 * 60)));
}

function sum(values) {
  return values.reduce((total, value) => total + (value || 0), 0);
}

function safeDivide(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[middle - 1] + sorted[middle]) / 2;
  return sorted[middle];
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatCostPerInstall(summary) {
  if (!summary.installs) return "-";
  return formatCurrency(summary.costPerInstall);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedPercent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function formatSignedPercentPoints(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}pp`;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function dedupeFlags(flags) {
  const seen = new Set();
  return flags.filter((flag) => {
    const key = `${flag.tone}-${flag.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildMappedSummary(dataset) {
  const mapped = METRIC_FIELDS.filter((field) => dataset.mapping[field]).map((field) => FRIENDLY_FIELD_NAMES[field]);
  if (!mapped.length) return "No mapped fields yet";
  return `Mapped: ${mapped.join(", ")}`;
}

function renderPreviewTable(table, dataset) {
  const head = table.querySelector("thead");
  const body = table.querySelector("tbody");
  const previewRows = dataset.body.slice(0, 5);
  head.innerHTML = `<tr>${dataset.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>`;
  body.innerHTML = previewRows
    .map(
      (row) => `
        <tr>
          ${dataset.headers.map((_, index) => `<td>${escapeHtml(row[index] ?? "")}</td>`).join("")}
        </tr>
      `
    )
    .join("");
}

function clearAllData() {
  state.datasets = [];
  state.normalizedRows = [];
  renderDatasets();
  renderAll();
  switchTab("upload");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function loadSampleData(options = {}) {
  state.datasets = [];
  const sampleGoogleAds = [
    ["Campaign", "Ad group", "App asset type", "App asset", "Count", "Cost", "Impr.", "Clicks", "CTR", "Installs"],
    ["Install Campaign - Broad", "Jakarta Fresh Graduates", "Image", "Office Benefits Static", "1", "320.50", "24000", "960", "4.00%", "40"],
    ["Install Campaign - Broad", "Jakarta Fresh Graduates", "Video", "Career Growth Reel", "1", "275.20", "18800", "890", "4.73%", "55"],
    ["Install Campaign - Lookalike", "High Intent Users", "Text", "Apply Faster Headline", "1", "190.10", "15100", "510", "3.38%", "22"],
    ["Install Campaign - Lookalike", "High Intent Users", "Image", "Blue App Screenshot", "1", "410.00", "30000", "780", "2.60%", "18"],
    ["Install Campaign - Remarketing", "Visited Job Detail", "Video", "Candidate Testimonial", "1", "155.75", "9800", "515", "5.26%", "44"],
  ];

  state.datasets.push(makeDatasetFromRows(sampleGoogleAds, "google_ads", "sample-google-ads.csv"));

  renderDatasets();
  rebuildNormalizedRows();
  renderAll();
  switchTab("campaigns");
  if (!options.auto) return;
}

function makeDatasetFromRows(rows, source, fileName) {
  const headers = rows[0];
  const body = rows.slice(1);
  return {
    id: crypto.randomUUID(),
    source,
    fileName,
    headers,
    body,
    mapping: guessMapping(headers),
    isSample: true,
  };
}
