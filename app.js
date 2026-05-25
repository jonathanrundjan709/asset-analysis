// ============================================
// ASSET & PLACEMENT ANALYSIS - MAIN ENGINE
// ============================================

"use strict";

// ============================================
// STATE
// ============================================
const APP = {
  files: [],          // { id, name, platform, week, rawText, headers, rows, dateRange }
  googleRows: [],     // normalized Google Ads rows
  metaRows: [],       // normalized Meta Ads rows
  guardrails: {
    meta: { Instagram: 59, Facebook: 49 },
    google: []        // [{ campaign, search, gdn, youtube }]
  }
};

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  wireNavTabs();
  wireUpload();
  wireGuardrails();
  wireExport();
});

function wireNavTabs() {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}


function wireUpload() {
  const zone = document.getElementById('uploadZone');
  const input = document.getElementById('fileInput');
  const btnSample = document.getElementById('btnLoadSample');
  const btnClear = document.getElementById('btnClearAll');

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });
  input.addEventListener('change', () => { handleFiles(input.files); input.value = ''; });
  btnSample.addEventListener('click', loadSampleData);
  btnClear.addEventListener('click', clearAll);
}

function wireGuardrails() {
  document.getElementById('btnAddGuardrail').addEventListener('click', addGuardrailCampaign);
  document.getElementById('metaIgGuardrail').addEventListener('change', e => {
    APP.guardrails.meta.Instagram = Number(e.target.value);
  });
  document.getElementById('metaFbGuardrail').addEventListener('change', e => {
    APP.guardrails.meta.Facebook = Number(e.target.value);
  });
}

function wireExport() {
  document.querySelectorAll('.export-btn').forEach(btn => {
    btn.addEventListener('click', () => handleExport(btn.dataset.export));
  });
}


// ============================================
// FILE HANDLING
// ============================================
async function handleFiles(fileList) {
  for (const file of fileList) {
    const rawText = await file.text();
    const parsed = parseCSVSmart(rawText);
    if (!parsed) continue;
    const platform = detectPlatform(parsed.headers, rawText);
    const dateRange = detectDateRange(rawText, file.name);
    const fileObj = {
      id: crypto.randomUUID(),
      name: file.name,
      platform,
      week: 'current',
      rawText,
      headers: parsed.headers,
      rows: parsed.rows,
      dateRange
    };
    APP.files.push(fileObj);
  }
  renderFilesList();
  runAnalysis();
}

function clearAll() {
  APP.files = [];
  APP.googleRows = [];
  APP.metaRows = [];
  renderFilesList();
  renderAllTabs();
  updateStats();
}


// ============================================
// CSV PARSER - handles Google Ads extra rows
// ============================================
function parseCSVSmart(text) {
  const allRows = parseCSVRaw(text);
  if (!allRows.length) return null;

  // Find the real header row by looking for known column patterns
  const googleIndicators = ['asset', 'asset type', 'clicks', 'ctr', 'impr', 'cost', 'install'];
  const metaIndicators = ['ad name', 'impressions', 'amount spent', 'results', 'ad set'];

  let headerIdx = 0;
  for (let i = 0; i < Math.min(allRows.length, 10); i++) {
    const rowLower = allRows[i].map(c => c.toLowerCase().trim());
    const matchGoogle = googleIndicators.filter(ind => rowLower.some(c => c.includes(ind))).length;
    const matchMeta = metaIndicators.filter(ind => rowLower.some(c => c.includes(ind))).length;
    if (matchGoogle >= 3 || matchMeta >= 3) {
      headerIdx = i;
      break;
    }
  }

  const headers = allRows[headerIdx].map(h => h.trim());
  const rows = allRows.slice(headerIdx + 1).filter(r => r.some(c => c.trim() !== ''));
  // Filter out summary/total rows
  const filtered = rows.filter(r => {
    const first = (r[0] || '').toLowerCase().trim();
    return first !== 'total' && first !== '' || r.slice(1).some(c => c.trim() !== '');
  });
  return { headers, rows: filtered };
}

function parseCSVRaw(text) {
  const rows = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
      continue;
    }
    if (ch === ',' && !inQuotes) { row.push(current); current = ''; continue; }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      row.push(current);
      rows.push(row);
      row = []; current = '';
      continue;
    }
    current += ch;
  }
  if (current.length || row.length) { row.push(current); rows.push(row); }
  return rows.map(r => r.map(v => v.trim()));
}


// ============================================
// PLATFORM DETECTION
// ============================================
function detectPlatform(headers, rawText) {
  const lower = headers.map(h => h.toLowerCase());
  // Google Ads indicators
  const gIndicators = ['segmentation_info.ad_network', 'asset type', 'app asset type', 'conv. rate'];
  const mIndicators = ['ad name', 'ad delivery', 'amount spent', 'ad set name', 'quality ranking'];
  
  const gScore = gIndicators.filter(ind => lower.some(h => h.includes(ind))).length;
  const mScore = mIndicators.filter(ind => lower.some(h => h.includes(ind))).length;

  // Also check raw text for "Asset details report" which is Google Ads
  if (rawText.toLowerCase().includes('asset details report')) return 'google';
  
  if (gScore > mScore) return 'google';
  if (mScore > gScore) return 'meta';
  
  // Fallback: check for specific column names
  if (lower.some(h => h.includes('asset'))) return 'google';
  if (lower.some(h => h.includes('ad name'))) return 'meta';
  
  return 'unknown';
}

function detectDateRange(rawText, fileName) {
  // Try to find date range in first few lines
  const lines = rawText.split('\n').slice(0, 5);
  for (const line of lines) {
    const match = line.match(/(\w+ \d{1,2},?\s*\d{4})\s*[-–]\s*(\w+ \d{1,2},?\s*\d{4})/);
    if (match) return { start: match[1], end: match[2] };
  }
  // Try filename
  const fnMatch = fileName.match(/(\d{4}[-_]\d{2}[-_]\d{2})/g);
  if (fnMatch && fnMatch.length >= 2) return { start: fnMatch[0], end: fnMatch[1] };
  if (fnMatch && fnMatch.length === 1) return { start: fnMatch[0], end: fnMatch[0] };
  return null;
}


// ============================================
// DATA CLEANING UTILITIES
// ============================================
function cleanNumber(val) {
  if (val === null || val === undefined || val === '') return 0;
  let s = String(val).trim();
  // Remove currency symbols, spaces
  s = s.replace(/[^\d.,%\-]/g, '');
  // Handle percentage
  if (s.includes('%')) {
    s = s.replace('%', '');
    s = s.replace(/,/g, '');
    return Number(s) / 100 || 0;
  }
  // Handle commas: "1,441" -> 1441
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(/,/g, '');
  }
  return Number(s) || 0;
}

function cleanNumberRaw(val) {
  // Same as cleanNumber but doesn't divide percentages
  if (val === null || val === undefined || val === '') return 0;
  let s = String(val).trim();
  s = s.replace(/[^\d.,%\-]/g, '');
  if (s.includes('%')) s = s.replace('%', '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(/,/g, '');
  return Number(s) || 0;
}

function getCol(row, headers, patterns) {
  for (const pat of patterns) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(pat.toLowerCase()));
    if (idx >= 0 && row[idx] !== undefined) return row[idx];
  }
  return '';
}

function getColExact(row, headers, names) {
  for (const name of names) {
    const idx = headers.findIndex(h => h.toLowerCase().trim() === name.toLowerCase().trim());
    if (idx >= 0 && row[idx] !== undefined) return row[idx];
  }
  return '';
}

function getColByIndex(row, headers, colName, excludeCol) {
  // Find column matching colName exactly, excluding columns matching excludeCol
  const lowerName = colName.toLowerCase().trim();
  const lowerExclude = excludeCol.toLowerCase().trim();
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().trim();
    if (h === lowerName && h !== lowerExclude) return row[i] || '';
    if (h.includes(lowerName) && !h.includes(lowerExclude) && h !== lowerExclude) return row[i] || '';
  }
  return '';
}

function safeDivide(num, den) {
  if (!den || den === 0) return 0;
  return num / den;
}

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].filter(v => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}


// ============================================
// GOOGLE ADS NORMALIZATION
// ============================================
function normalizeGoogleAds(file) {
  const { headers, rows } = file;
  const normalized = [];

  for (const row of rows) {
    const channel = mapGoogleChannel(getCol(row, headers, ['segmentation_info.ad_network', 'network', 'ad network']));
    const campaign = getCol(row, headers, ['campaign']) || inferFromFilename(file.name, 'campaign');
    const adGroup = getCol(row, headers, ['ad group', 'adgroup']) || inferFromFilename(file.name, 'adgroup');
    const assetType = getColExact(row, headers, ['asset type', 'app asset type']) || getCol(row, headers, ['asset type', 'app asset type']);
    const asset = getColExact(row, headers, ['asset', 'app asset']) || getColByIndex(row, headers, 'asset', 'asset type');
    const cost = cleanNumber(getCol(row, headers, ['cost']));
    const impr = cleanNumber(getCol(row, headers, ['impr.', 'impr', 'impressions']));
    const clicks = cleanNumber(getCol(row, headers, ['clicks']));
    const installs = cleanNumber(getCol(row, headers, ['installs', 'install', 'conv. (install)']));

    // Skip rows with no meaningful data
    if (!asset && !assetType && cost === 0 && impr === 0) continue;
    // Skip GMAIL/MAPS rows unless they have spend/clicks/installs
    if (channel === 'Gmail' || channel === 'Maps') {
      if (cost === 0 && clicks === 0 && installs === 0) continue;
    }

    normalized.push({
      platform: 'google',
      channel: channel || 'Unknown',
      campaign: campaign || 'Unknown Campaign',
      adGroup: adGroup || 'Unknown Ad Group',
      assetType: normalizeGoogleAssetType(assetType),
      asset: asset || 'Unknown Asset',
      cost,
      impressions: impr,
      clicks,
      installs,
      week: file.week,
      // Computed later
      ctr: 0,
      clickToInstall: 0,
      costPerInstall: 0,
      count: 1
    });
  }
  return normalized;
}

function mapGoogleChannel(raw) {
  const s = (raw || '').toUpperCase().trim();
  if (s.includes('SEARCH_PARTNER') || s.includes('SEARCH PARTNER')) return 'Search Partner';
  if (s.includes('SEARCH')) return 'Google Search';
  if (s.includes('DISPLAY') || s.includes('GDN')) return 'GDN';
  if (s.includes('YOUTUBE')) return 'YouTube';
  if (s.includes('GMAIL')) return 'Gmail';
  if (s.includes('MAPS')) return 'Maps';
  if (s) return s;
  return '';
}

function normalizeGoogleAssetType(raw) {
  const s = (raw || '').toLowerCase().trim();
  if (s.includes('headline')) return 'Headline';
  if (s.includes('description') || s.includes('copywriting')) return 'Description';
  if (s.includes('youtube') && s.includes('video')) return 'YouTube Video';
  if (s.includes('marketing image') || (s.includes('image') && !s.includes('motion'))) return 'Static Image';
  if (s.includes('motion') || s.includes('video')) return 'Video';
  if (s) return raw.trim();
  return 'Other';
}

function inferFromFilename(name, type) {
  // Try to extract campaign or adgroup from filename
  const clean = name.replace(/\.csv$/i, '').replace(/[-_]/g, ' ');
  if (type === 'campaign') return '';
  if (type === 'adgroup') return '';
  return '';
}


// ============================================
// META ADS NORMALIZATION
// ============================================
function normalizeMetaAds(file) {
  const { headers, rows } = file;
  const normalized = [];
  const hasClicks = headers.some(h => h.toLowerCase().includes('click') && !h.toLowerCase().includes('cost'));
  const hasResultIndicator = headers.some(h => h.toLowerCase().includes('result indicator') || h.toLowerCase().includes('result type'));

  for (const row of rows) {
    const adName = getCol(row, headers, ['ad name']);
    const adSetName = getCol(row, headers, ['ad set name', 'adset name']);
    const campaign = getCol(row, headers, ['campaign name', 'campaign']);
    const cost = cleanNumber(getColExact(row, headers, ['amount spent (idr)', 'amount spent', 'spent']));
    const impr = cleanNumber(getCol(row, headers, ['impressions']));

    let clicks = 0;
    if (hasClicks) {
      clicks = cleanNumber(getColExact(row, headers, [
        'link clicks', 'clicks (all)', 'clicks', 'outbound clicks'
      ]));
    }

    // Installs
    let installs = 0;
    const mobileInstalls = cleanNumber(getCol(row, headers, ['mobile app installs']));
    const desktopInstalls = cleanNumber(getCol(row, headers, ['desktop app installs']));
    if (mobileInstalls || desktopInstalls) {
      installs = mobileInstalls + desktopInstalls;
    } else {
      // Check Results column if result indicator is mobile_app_install
      const resultIndicator = getCol(row, headers, ['result indicator', 'result type', 'optimization goal']);
      const results = cleanNumber(getCol(row, headers, ['results']));
      if ((resultIndicator || '').toLowerCase().includes('install') || 
          (resultIndicator || '').toLowerCase().includes('app')) {
        installs = results;
      } else if (results > 0 && !resultIndicator) {
        installs = results; // Assume results = installs if no indicator
      }
    }

    // Rankings
    const qualityRanking = getCol(row, headers, ['quality ranking']);
    const engagementRanking = getCol(row, headers, ['engagement rate ranking', 'engagement ranking']);
    const conversionRanking = getCol(row, headers, ['conversion rate ranking', 'conversion ranking']);

    if (!adName && cost === 0 && impr === 0) continue;

    normalized.push({
      platform: 'meta',
      channel: 'Meta',
      campaign: campaign || 'Unknown Campaign',
      adGroup: adSetName || 'Unknown Ad Set',
      assetType: inferMetaAssetType(adName),
      asset: adName || 'Unknown Ad',
      cost,
      impressions: impr,
      clicks: hasClicks ? clicks : null,
      installs,
      week: file.week,
      hasClicks,
      qualityRanking: qualityRanking || '',
      engagementRanking: engagementRanking || '',
      conversionRanking: conversionRanking || '',
      ctr: 0,
      clickToInstall: 0,
      costPerInstall: 0,
      count: 1
    });
  }
  return normalized;
}

function inferMetaAssetType(adName) {
  const s = (adName || '').toLowerCase();
  if (s.includes('kol')) return 'KOL';
  if (s.includes('social') || s.includes('sosmed')) return 'Social Media Video';
  if (s.includes('vina')) return 'Vina Post Lebaran';
  if (s.includes('carousel')) return 'Job Listing Carousel';
  if (s.includes('video') || s.includes('tiktok style')) return 'Video';
  if (s.includes('static') || s.includes('image')) return 'Static Image';
  return 'Other';
}


// ============================================
// GROUPING & AGGREGATION
// ============================================
function groupAndAggregate(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const key = `${row.channel}||${row.campaign}||${row.adGroup}||${row.assetType}||${row.asset}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        platform: row.platform,
        channel: row.channel,
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
        qualityRanking: row.qualityRanking || '',
        engagementRanking: row.engagementRanking || '',
        conversionRanking: row.conversionRanking || '',
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
    // Keep last ranking values
    if (row.qualityRanking) g.qualityRanking = row.qualityRanking;
    if (row.engagementRanking) g.engagementRanking = row.engagementRanking;
    if (row.conversionRanking) g.conversionRanking = row.conversionRanking;
  }

  // Compute derived metrics
  const result = [];
  for (const g of grouped.values()) {
    g.ctr = g.hasClicks ? safeDivide(g.clicks, g.impressions) : null;
    g.clickToInstall = (g.hasClicks && g.clicks > 0) ? safeDivide(g.installs, g.clicks) : null;
    g.costPerInstall = safeDivide(g.cost, g.installs);
    result.push(g);
  }
  return result;
}


// ============================================
// BENCHMARKING & ACTION PLAN
// ============================================
function computeBenchmarks(groupedRows) {
  // Group by asset type
  const byType = {};
  for (const row of groupedRows) {
    if (!byType[row.assetType]) byType[row.assetType] = [];
    byType[row.assetType].push(row);
  }

  const benchmarks = {};
  for (const [type, rows] of Object.entries(byType)) {
    const ctrs = rows.filter(r => r.ctr !== null && r.ctr > 0).map(r => r.ctr);
    const c2is = rows.filter(r => r.clickToInstall !== null && r.clickToInstall > 0).map(r => r.clickToInstall);
    const cpis = rows.filter(r => r.costPerInstall > 0).map(r => r.costPerInstall);
    const costs = rows.filter(r => r.cost > 0).map(r => r.cost);
    const installs = rows.filter(r => r.installs > 0).map(r => r.installs);

    benchmarks[type] = {
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
  const bench = benchmarks[row.assetType];
  if (!bench) return 'N/A';

  // If clicks data available → use CTR + Click>Install% logic
  if (row.ctr !== null && bench.medianCTR > 0) {
    const ctrAbove = row.ctr >= bench.medianCTR;
    const c2iAbove = row.clickToInstall !== null && row.clickToInstall >= bench.medianClickToInstall;

    if (ctrAbove && c2iAbove) return 'STAY';
    if (ctrAbove && !c2iAbove) return 'CHANGE';
    return 'PAUSE';
  }

  // Fallback when clicks/CTR not available
  if (row.costPerInstall > 0 && bench.medianCPI > 0) {
    const cpiBelow = row.costPerInstall <= bench.medianCPI;
    const installsAbove = row.installs >= bench.medianInstalls;

    if (cpiBelow && installsAbove) return 'STAY';
    if (!cpiBelow && installsAbove) return 'CHANGE';
    return 'PAUSE';
  }

  // Meta ranking fallback
  if (row.qualityRanking || row.engagementRanking || row.conversionRanking) {
    return assignActionFromRankings(row);
  }

  return 'N/A';
}

function assignActionFromRankings(row) {
  const quality = rankingScore(row.qualityRanking);
  const engagement = rankingScore(row.engagementRanking);
  const conversion = rankingScore(row.conversionRanking);

  if (quality >= 2 && engagement >= 2 && conversion >= 2) return 'STAY';
  if (engagement >= 2 && conversion < 2) return 'CHANGE';
  if (engagement < 2 || quality < 2) return 'PAUSE';
  return 'N/A';
}

function rankingScore(val) {
  const s = (val || '').toLowerCase();
  if (s.includes('above')) return 3;
  if (s.includes('average') && !s.includes('below')) return 2;
  if (s.includes('below')) return 1;
  return 0;
}


// ============================================
// PLACEMENT ANALYSIS
// ============================================
function computePlacementAnalysis(groupedRows) {
  // Group by campaign + channel (placement)
  const byPlacement = new Map();
  for (const row of groupedRows) {
    const key = `${row.campaign}||${row.channel}`;
    if (!byPlacement.has(key)) {
      byPlacement.set(key, {
        platform: row.platform,
        campaign: row.campaign,
        placement: row.channel,
        cost: 0, impressions: 0, clicks: 0, installs: 0,
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

  // Compute campaign totals for cost share
  const campaignTotals = {};
  for (const p of byPlacement.values()) {
    if (!campaignTotals[p.campaign]) campaignTotals[p.campaign] = 0;
    campaignTotals[p.campaign] += p.cost;
  }

  const results = [];
  for (const p of byPlacement.values()) {
    const costShare = safeDivide(p.cost, campaignTotals[p.campaign]);
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
      guardrailStatus,
      actionPlan: guardrailStatus === 'Above Guardrail' ? 'PAUSE' : 
                  (costPerInstall > 0 && ctr !== null ? 'STAY' : 'N/A')
    });
  }
  return results;
}

function checkGuardrail(platform, campaign, placement, costShare) {
  const pct = costShare * 100;
  if (platform === 'meta') {
    const limit = APP.guardrails.meta[placement];
    if (limit && pct > limit) return 'Above Guardrail';
    if (limit) return 'Within Guardrail';
    return 'N/A';
  }
  if (platform === 'google') {
    const config = APP.guardrails.google.find(g => 
      g.campaign.toLowerCase().trim() === campaign.toLowerCase().trim()
    );
    if (!config) return 'N/A';
    let limit = null;
    if (placement === 'Google Search') limit = config.search;
    else if (placement === 'GDN') limit = config.gdn;
    else if (placement === 'YouTube') limit = config.youtube;
    if (limit && pct > limit) return 'Above Guardrail';
    if (limit) return 'Within Guardrail';
    return 'N/A';
  }
  return 'N/A';
}


// ============================================
// WEEK-OVER-WEEK ANALYSIS
// ============================================
function computeWoW(allGrouped) {
  const current = allGrouped.filter(r => r.week === 'current');
  const previous = allGrouped.filter(r => r.week === 'previous');

  if (!current.length || !previous.length) return [];

  const prevMap = new Map();
  for (const r of previous) {
    const key = `${r.platform}||${r.campaign}||${r.adGroup}||${r.assetType}||${r.asset}`;
    prevMap.set(key, r);
  }

  const results = [];
  for (const curr of current) {
    const key = `${curr.platform}||${curr.campaign}||${curr.adGroup}||${curr.assetType}||${curr.asset}`;
    const prev = prevMap.get(key);
    if (!prev) continue;

    const wowCost = safeDivide(curr.cost - prev.cost, prev.cost);
    const wowImpr = safeDivide(curr.impressions - prev.impressions, prev.impressions);
    const wowClicks = (curr.hasClicks && prev.hasClicks) ? safeDivide(curr.clicks - prev.clicks, prev.clicks) : null;
    const wowCTR = (curr.ctr !== null && prev.ctr !== null && prev.ctr > 0) ? safeDivide(curr.ctr - prev.ctr, prev.ctr) : null;
    const wowC2I = (curr.clickToInstall !== null && prev.clickToInstall !== null && prev.clickToInstall > 0) ? 
      safeDivide(curr.clickToInstall - prev.clickToInstall, prev.clickToInstall) : null;
    const wowInstalls = safeDivide(curr.installs - prev.installs, prev.installs || 1);
    const wowCPI = (curr.costPerInstall > 0 && prev.costPerInstall > 0) ? 
      safeDivide(curr.costPerInstall - prev.costPerInstall, prev.costPerInstall) : null;

    const flags = [];
    if (wowCTR !== null && wowCTR < -0.2) flags.push('CTR drop >20%');
    if (wowC2I !== null && wowC2I < -0.2) flags.push('Click>Install% drop >20%');
    if (wowCPI !== null && wowCPI > 0.2) flags.push('CPI increase >20%');
    if (wowCost > 0 && wowInstalls < 0) flags.push('Cost up, Installs down');

    results.push({
      platform: curr.platform,
      campaign: curr.campaign,
      adGroup: curr.adGroup,
      assetType: curr.assetType,
      asset: curr.asset,
      currCost: curr.cost, prevCost: prev.cost, wowCost,
      currImpr: curr.impressions, prevImpr: prev.impressions, wowImpr,
      currClicks: curr.clicks, prevClicks: prev.clicks, wowClicks,
      currCTR: curr.ctr, prevCTR: prev.ctr, wowCTR,
      currC2I: curr.clickToInstall, prevC2I: prev.clickToInstall, wowC2I,
      currInstalls: curr.installs, prevInstalls: prev.installs, wowInstalls,
      currCPI: curr.costPerInstall, prevCPI: prev.costPerInstall, wowCPI,
      flags
    });
  }
  return results;
}


// ============================================
// MAIN ANALYSIS PIPELINE
// ============================================
function runAnalysis() {
  // Normalize all files
  let allGoogle = [];
  let allMeta = [];

  for (const file of APP.files) {
    if (file.platform === 'google') {
      allGoogle = allGoogle.concat(normalizeGoogleAds(file));
    } else if (file.platform === 'meta') {
      allMeta = allMeta.concat(normalizeMetaAds(file));
    }
  }

  // Group & aggregate
  APP.googleRows = groupAndAggregate(allGoogle);
  APP.metaRows = groupAndAggregate(allMeta);

  // Compute benchmarks
  const googleBenchmarks = computeBenchmarks(APP.googleRows);
  const metaBenchmarks = computeBenchmarks(APP.metaRows);

  // Assign action plans
  for (const row of APP.googleRows) {
    row.actionPlan = assignActionPlan(row, googleBenchmarks);
  }
  for (const row of APP.metaRows) {
    row.actionPlan = assignActionPlan(row, metaBenchmarks);
  }

  // Store benchmarks
  APP.googleBenchmarks = googleBenchmarks;
  APP.metaBenchmarks = metaBenchmarks;

  // Placement analysis
  APP.placementGoogle = computePlacementAnalysis(APP.googleRows);
  APP.placementMeta = computePlacementAnalysis(APP.metaRows);

  // WoW
  const allGroupedForWoW = [...groupAndAggregate(allGoogle), ...groupAndAggregate(allMeta)];
  APP.wowResults = computeWoW(allGroupedForWoW);

  // Render
  renderAllTabs();
  updateStats();
}


// ============================================
// RENDERING - FILES LIST
// ============================================
function renderFilesList() {
  const panel = document.getElementById('filesPanel');
  const list = document.getElementById('filesList');
  const badge = document.getElementById('fileCountBadge');

  if (!APP.files.length) {
    panel.style.display = 'none';
    document.getElementById('previewPanel').style.display = 'none';
    return;
  }

  panel.style.display = '';
  badge.textContent = `${APP.files.length} files`;

  list.innerHTML = APP.files.map(f => `
    <div class="file-card" data-id="${f.id}">
      <div class="file-card-info">
        <span class="platform-badge ${f.platform}">${f.platform === 'google' ? 'Google Ads' : f.platform === 'meta' ? 'Meta Ads' : 'Unknown'}</span>
        <div>
          <div class="file-card-name">${esc(f.name)}</div>
          <div class="file-card-meta">${f.rows.length} rows${f.dateRange ? ' | ' + f.dateRange.start + ' - ' + f.dateRange.end : ''}</div>
        </div>
      </div>
      <div class="file-card-actions">
        <select class="week-select" data-id="${f.id}" data-field="week">
          <option value="current" ${f.week === 'current' ? 'selected' : ''}>Current Week</option>
          <option value="previous" ${f.week === 'previous' ? 'selected' : ''}>Previous Week</option>
        </select>
        <select class="week-select" data-id="${f.id}" data-field="platform">
          <option value="google" ${f.platform === 'google' ? 'selected' : ''}>Google Ads</option>
          <option value="meta" ${f.platform === 'meta' ? 'selected' : ''}>Meta Ads</option>
          <option value="unknown" ${f.platform === 'unknown' ? 'selected' : ''}>Unknown</option>
        </select>
        <button class="btn btn-sm btn-ghost" data-preview="${f.id}">Preview</button>
        <button class="btn btn-sm btn-ghost btn-danger" data-remove="${f.id}">Remove</button>
      </div>
    </div>
  `).join('');

  // Wire events
  list.querySelectorAll('[data-field="week"]').forEach(sel => {
    sel.addEventListener('change', e => {
      const file = APP.files.find(f => f.id === e.target.dataset.id);
      if (file) { file.week = e.target.value; runAnalysis(); }
    });
  });
  list.querySelectorAll('[data-field="platform"]').forEach(sel => {
    sel.addEventListener('change', e => {
      const file = APP.files.find(f => f.id === e.target.dataset.id);
      if (file) { file.platform = e.target.value; renderFilesList(); runAnalysis(); }
    });
  });
  list.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', e => {
      APP.files = APP.files.filter(f => f.id !== e.target.dataset.remove);
      renderFilesList(); runAnalysis();
    });
  });
  list.querySelectorAll('[data-preview]').forEach(btn => {
    btn.addEventListener('click', e => {
      const file = APP.files.find(f => f.id === e.target.dataset.preview);
      if (file) renderPreview(file);
    });
  });
}

function renderPreview(file) {
  const panel = document.getElementById('previewPanel');
  const table = document.getElementById('previewTable');
  panel.style.display = '';
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  thead.innerHTML = `<tr>${file.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr>`;
  tbody.innerHTML = file.rows.slice(0, 10).map(row =>
    `<tr>${file.headers.map((_, i) => `<td>${esc(row[i] || '')}</td>`).join('')}</tr>`
  ).join('');
}


// ============================================
// RENDERING - ANALYSIS TABLES
// ============================================
function renderAllTabs() {
  renderGoogleAnalysis();
  renderMetaAnalysis();
  renderPlacementAnalysis();
  renderWoWAnalysis();
  renderSummary();
}

function renderGoogleAnalysis() {
  const noData = document.getElementById('googleNoData');
  const analysis = document.getElementById('googleAnalysis');

  if (!APP.googleRows.length) {
    noData.style.display = '';
    analysis.style.display = 'none';
    return;
  }
  noData.style.display = 'none';
  analysis.style.display = '';

  renderAssetTypeCards('googleAssetTypeSummary', APP.googleRows, APP.googleBenchmarks);
  renderBenchmarks('googleBenchmarks', APP.googleBenchmarks);
  renderAnalysisTable('googleTable', APP.googleRows, APP.googleBenchmarks, true);
}

function renderMetaAnalysis() {
  const noData = document.getElementById('metaNoData');
  const analysis = document.getElementById('metaAnalysis');

  if (!APP.metaRows.length) {
    noData.style.display = '';
    analysis.style.display = 'none';
    return;
  }
  noData.style.display = 'none';
  analysis.style.display = '';

  renderAssetTypeCards('metaAssetTypeSummary', APP.metaRows, APP.metaBenchmarks);
  renderBenchmarks('metaBenchmarks', APP.metaBenchmarks);
  renderAnalysisTable('metaTable', APP.metaRows, APP.metaBenchmarks, false);
}

function renderAssetTypeCards(containerId, rows, benchmarks) {
  const container = document.getElementById(containerId);
  const byType = {};
  for (const r of rows) {
    if (!byType[r.assetType]) byType[r.assetType] = [];
    byType[r.assetType].push(r);
  }

  container.innerHTML = Object.entries(byType).map(([type, items]) => {
    const totalCost = items.reduce((s, r) => s + r.cost, 0);
    const totalImpr = items.reduce((s, r) => s + r.impressions, 0);
    const totalInstalls = items.reduce((s, r) => s + r.installs, 0);
    const avgCTR = safeDivide(items.reduce((s, r) => s + (r.clicks || 0), 0), totalImpr);
    const avgCPI = safeDivide(totalCost, totalInstalls);
    const stayCount = items.filter(r => r.actionPlan === 'STAY').length;
    const changeCount = items.filter(r => r.actionPlan === 'CHANGE').length;
    const pauseCount = items.filter(r => r.actionPlan === 'PAUSE').length;

    return `
      <div class="asset-type-card">
        <h4>${esc(type)} <span class="badge">${items.length} assets</span></h4>
        <div class="card-metrics">
          <div class="card-metric"><span class="card-metric-label">Cost</span><span class="card-metric-value">${fmtCurrency(totalCost)}</span></div>
          <div class="card-metric"><span class="card-metric-label">Installs</span><span class="card-metric-value">${fmtNum(totalInstalls)}</span></div>
          <div class="card-metric"><span class="card-metric-label">Avg CTR</span><span class="card-metric-value">${fmtPct(avgCTR)}</span></div>
          <div class="card-metric"><span class="card-metric-label">Avg CPI</span><span class="card-metric-value">${fmtCurrency(avgCPI)}</span></div>
          <div class="card-metric"><span class="card-metric-label">Stay</span><span class="card-metric-value" style="color:var(--stay)">${stayCount}</span></div>
          <div class="card-metric"><span class="card-metric-label">Change</span><span class="card-metric-value" style="color:var(--change)">${changeCount}</span></div>
          <div class="card-metric"><span class="card-metric-label">Pause</span><span class="card-metric-value" style="color:var(--pause)">${pauseCount}</span></div>
        </div>
      </div>
    `;
  }).join('');
}


function renderBenchmarks(containerId, benchmarks) {
  const container = document.getElementById(containerId);
  const types = Object.entries(benchmarks);
  if (!types.length) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <h4>Median Benchmarks by Asset Type</h4>
    <div class="benchmark-groups">
      ${types.map(([type, b]) => `
        <div class="benchmark-group">
          <div class="benchmark-group-title">${esc(type)}</div>
          <div class="benchmark-item"><span>CTR</span><span>${fmtPct(b.medianCTR)}</span></div>
          <div class="benchmark-item"><span>Click>Install%</span><span>${fmtPct(b.medianClickToInstall)}</span></div>
          <div class="benchmark-item"><span>CPI</span><span>${fmtCurrency(b.medianCPI)}</span></div>
          <div class="benchmark-item"><span>Cost</span><span>${fmtCurrency(b.medianCost)}</span></div>
          <div class="benchmark-item"><span>Installs</span><span>${fmtNum(b.medianInstalls)}</span></div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderAnalysisTable(tableId, rows, benchmarks, hasClicksAlways) {
  const table = document.getElementById(tableId);
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');

  thead.innerHTML = `<tr>
    <th>Channel</th>
    <th>Campaign</th>
    <th>Ad Group</th>
    <th>Asset Type</th>
    <th>Asset</th>
    <th class="numeric">Count</th>
    <th class="numeric">Cost</th>
    <th class="numeric">Impr.</th>
    <th class="numeric">Clicks</th>
    <th class="numeric">CTR</th>
    <th class="numeric">Click>Install%</th>
    <th class="numeric">Installs</th>
    <th class="numeric">Cost/Install</th>
    <th>CTR vs Med</th>
    <th>C2I vs Med</th>
    <th>Action Plan</th>
  </tr>`;

  // Sort by asset type then cost desc
  const sorted = [...rows].sort((a, b) => {
    if (a.assetType !== b.assetType) return a.assetType.localeCompare(b.assetType);
    return b.cost - a.cost;
  });

  tbody.innerHTML = sorted.map(row => {
    const bench = benchmarks[row.assetType] || {};
    const ctrVsMed = (row.ctr !== null && bench.medianCTR) ? row.ctr / bench.medianCTR - 1 : null;
    const c2iVsMed = (row.clickToInstall !== null && bench.medianClickToInstall) ? row.clickToInstall / bench.medianClickToInstall - 1 : null;
    const rowClass = row.actionPlan === 'STAY' ? 'row-stay' : row.actionPlan === 'CHANGE' ? 'row-change' : row.actionPlan === 'PAUSE' ? 'row-pause' : '';

    return `<tr class="${rowClass}">
      <td>${esc(row.channel)}</td>
      <td>${esc(row.campaign)}</td>
      <td>${esc(row.adGroup)}</td>
      <td>${esc(row.assetType)}</td>
      <td><strong>${esc(row.asset)}</strong></td>
      <td class="numeric">${row.count}</td>
      <td class="numeric">${fmtCurrency(row.cost)}</td>
      <td class="numeric">${fmtNum(row.impressions)}</td>
      <td class="numeric">${row.hasClicks !== false ? fmtNum(row.clicks) : '-'}</td>
      <td class="numeric">${row.ctr !== null ? fmtPct(row.ctr) : '-'}</td>
      <td class="numeric">${row.clickToInstall !== null ? fmtPct(row.clickToInstall) : '-'}</td>
      <td class="numeric">${fmtNum(row.installs)}</td>
      <td class="numeric">${row.installs > 0 ? fmtCurrency(row.costPerInstall) : '-'}</td>
      <td>${renderBenchIndicator(ctrVsMed)}</td>
      <td>${renderBenchIndicator(c2iVsMed)}</td>
      <td>${renderActionLabel(row.actionPlan)}</td>
    </tr>`;
  }).join('');
}

function renderBenchIndicator(val) {
  if (val === null) return '<span class="bench-indicator at">-</span>';
  const cls = val >= 0 ? 'above' : 'below';
  const arrow = val >= 0 ? '&#9650;' : '&#9660;';
  return `<span class="bench-indicator ${cls}">${arrow} ${(val * 100).toFixed(1)}%</span>`;
}

function renderActionLabel(action) {
  if (action === 'STAY') return '<span class="action-label stay">STAY</span>';
  if (action === 'CHANGE') return '<span class="action-label change">CHANGE</span>';
  if (action === 'PAUSE') return '<span class="action-label pause">PAUSE / REPLACE</span>';
  return '<span class="action-label" style="background:#f1f5f9;color:#64748b;">N/A</span>';
}


// ============================================
// RENDERING - PLACEMENT ANALYSIS
// ============================================
function renderPlacementAnalysis() {
  const noData = document.getElementById('placementNoData');
  const analysis = document.getElementById('placementAnalysis');
  const allPlacements = [...(APP.placementGoogle || []), ...(APP.placementMeta || [])];

  if (!allPlacements.length) {
    noData.style.display = '';
    analysis.style.display = 'none';
    return;
  }
  noData.style.display = 'none';
  analysis.style.display = '';

  // Guardrail flags
  const flagsDiv = document.getElementById('placementGuardrailFlags');
  const aboveGuardrail = allPlacements.filter(p => p.guardrailStatus === 'Above Guardrail');
  const withinGuardrail = allPlacements.filter(p => p.guardrailStatus === 'Within Guardrail');

  flagsDiv.innerHTML = [
    ...aboveGuardrail.map(p => `<span class="guardrail-flag above">&#9888; ${esc(p.campaign)} - ${esc(p.placement)}: ${fmtPct(p.costShare)} cost share (Above Guardrail)</span>`),
    ...withinGuardrail.map(p => `<span class="guardrail-flag ok">&#10003; ${esc(p.campaign)} - ${esc(p.placement)}: Within Guardrail</span>`)
  ].join('');

  // Table
  const table = document.getElementById('placementTable');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');

  thead.innerHTML = `<tr>
    <th>Platform</th>
    <th>Campaign</th>
    <th>Placement</th>
    <th class="numeric">Cost</th>
    <th class="numeric">Impr.</th>
    <th class="numeric">Clicks</th>
    <th class="numeric">CTR</th>
    <th class="numeric">Click>Install%</th>
    <th class="numeric">Installs</th>
    <th class="numeric">Cost/Install</th>
    <th class="numeric">Cost Share</th>
    <th>Guardrail</th>
    <th>Action Plan</th>
  </tr>`;

  tbody.innerHTML = allPlacements.sort((a, b) => b.cost - a.cost).map(p => `
    <tr class="${p.guardrailStatus === 'Above Guardrail' ? 'row-pause' : ''}">
      <td>${p.platform === 'google' ? 'Google Ads' : 'Meta Ads'}</td>
      <td>${esc(p.campaign)}</td>
      <td>${esc(p.placement)}</td>
      <td class="numeric">${fmtCurrency(p.cost)}</td>
      <td class="numeric">${fmtNum(p.impressions)}</td>
      <td class="numeric">${p.hasClicks ? fmtNum(p.clicks) : '-'}</td>
      <td class="numeric">${p.ctr !== null ? fmtPct(p.ctr) : '-'}</td>
      <td class="numeric">${p.clickToInstall !== null ? fmtPct(p.clickToInstall) : '-'}</td>
      <td class="numeric">${fmtNum(p.installs)}</td>
      <td class="numeric">${p.installs > 0 ? fmtCurrency(p.costPerInstall) : '-'}</td>
      <td class="numeric">${fmtPct(p.costShare)}</td>
      <td>${p.guardrailStatus === 'Above Guardrail' ? '<span class="guardrail-flag above" style="margin:0;padding:3px 8px;">Above</span>' : p.guardrailStatus === 'Within Guardrail' ? '<span class="guardrail-flag ok" style="margin:0;padding:3px 8px;">OK</span>' : '-'}</td>
      <td>${renderActionLabel(p.guardrailStatus === 'Above Guardrail' ? 'PAUSE' : 'STAY')}</td>
    </tr>
  `).join('');
}


// ============================================
// RENDERING - WEEK-OVER-WEEK
// ============================================
function renderWoWAnalysis() {
  const noData = document.getElementById('wowNoData');
  const analysis = document.getElementById('wowAnalysis');

  if (!APP.wowResults || !APP.wowResults.length) {
    noData.style.display = '';
    analysis.style.display = 'none';
    return;
  }
  noData.style.display = 'none';
  analysis.style.display = '';

  // Flags
  const flagsDiv = document.getElementById('wowFlags');
  const allFlags = APP.wowResults.flatMap(r => r.flags.map(f => ({ flag: f, asset: r.asset, campaign: r.campaign })));

  const criticalFlags = allFlags.filter(f => f.flag.includes('Cost up') || f.flag.includes('CPI increase'));
  const warningFlags = allFlags.filter(f => f.flag.includes('drop'));

  flagsDiv.innerHTML = [
    ...criticalFlags.map(f => `<span class="wow-flag critical">&#9888; ${esc(f.asset)}: ${esc(f.flag)}</span>`),
    ...warningFlags.map(f => `<span class="wow-flag warning">&#9888; ${esc(f.asset)}: ${esc(f.flag)}</span>`)
  ].join('');

  // Table
  const table = document.getElementById('wowTable');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');

  thead.innerHTML = `<tr>
    <th>Platform</th>
    <th>Campaign</th>
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
    <tr class="${r.flags.length > 0 ? 'row-pause' : ''}">
      <td>${r.platform === 'google' ? 'Google' : 'Meta'}</td>
      <td>${esc(r.campaign)}</td>
      <td>${esc(r.assetType)}</td>
      <td><strong>${esc(r.asset)}</strong></td>
      <td class="numeric">${renderWoWDelta(r.wowCost)}</td>
      <td class="numeric">${renderWoWDelta(r.wowImpr)}</td>
      <td class="numeric">${renderWoWDelta(r.wowClicks)}</td>
      <td class="numeric">${renderWoWDelta(r.wowCTR)}</td>
      <td class="numeric">${renderWoWDelta(r.wowC2I)}</td>
      <td class="numeric">${renderWoWDelta(r.wowInstalls)}</td>
      <td class="numeric">${renderWoWDeltaInverse(r.wowCPI)}</td>
      <td>${r.flags.map(f => `<span class="wow-flag critical" style="font-size:0.68rem;padding:2px 6px;">${esc(f)}</span>`).join(' ')}</td>
    </tr>
  `).join('');
}

function renderWoWDelta(val) {
  if (val === null) return '<span class="wow-delta neutral">-</span>';
  const cls = val >= 0 ? 'positive' : 'negative';
  const sign = val >= 0 ? '+' : '';
  return `<span class="wow-delta ${cls}">${sign}${(val * 100).toFixed(1)}%</span>`;
}

function renderWoWDeltaInverse(val) {
  // For CPI, decrease is good, increase is bad
  if (val === null) return '<span class="wow-delta neutral">-</span>';
  const cls = val <= 0 ? 'positive' : 'negative';
  const sign = val >= 0 ? '+' : '';
  return `<span class="wow-delta ${cls}">${sign}${(val * 100).toFixed(1)}%</span>`;
}


// ============================================
// RENDERING - SUMMARY
// ============================================
function renderSummary() {
  const allRows = [...APP.googleRows, ...APP.metaRows];
  const execDiv = document.getElementById('execSummary');
  const typeDiv = document.getElementById('assetTypeSummaryAll');
  const actionDiv = document.getElementById('actionPlanOverview');

  if (!allRows.length) {
    execDiv.innerHTML = '<p class="empty-state">Generate analysis first to see the executive summary.</p>';
    typeDiv.innerHTML = '<p class="empty-state">No data available yet.</p>';
    actionDiv.innerHTML = '<p class="empty-state">No data available yet.</p>';
    return;
  }

  // Executive summary
  const stayAssets = allRows.filter(r => r.actionPlan === 'STAY');
  const changeAssets = allRows.filter(r => r.actionPlan === 'CHANGE');
  const pauseAssets = allRows.filter(r => r.actionPlan === 'PAUSE');

  const bestAsset = [...allRows].filter(r => r.installs > 0).sort((a, b) => a.costPerInstall - b.costPerInstall)[0];
  const worstAsset = [...allRows].filter(r => r.installs > 0).sort((a, b) => b.costPerInstall - a.costPerInstall)[0];

  // Best asset type (by avg CPI)
  const byType = {};
  for (const r of allRows) {
    if (!byType[r.assetType]) byType[r.assetType] = { cost: 0, installs: 0 };
    byType[r.assetType].cost += r.cost;
    byType[r.assetType].installs += r.installs;
  }
  const typePerf = Object.entries(byType).map(([t, d]) => ({ type: t, cpi: safeDivide(d.cost, d.installs), installs: d.installs })).filter(t => t.installs > 0);
  const bestType = typePerf.sort((a, b) => a.cpi - b.cpi)[0];
  const worstType = typePerf.sort((a, b) => b.cpi - a.cpi)[0];

  const placementAbove = [...(APP.placementGoogle || []), ...(APP.placementMeta || [])].filter(p => p.guardrailStatus === 'Above Guardrail');

  const summaryCards = [];
  if (bestType) summaryCards.push({ cls: 'highlight-good', title: 'Best Asset Type', text: `${bestType.type} with CPI ${fmtCurrency(bestType.cpi)} and ${fmtNum(bestType.installs)} installs.` });
  if (bestAsset) summaryCards.push({ cls: 'highlight-good', title: 'Best Asset', text: `"${bestAsset.asset}" (${bestAsset.assetType}) with CPI ${fmtCurrency(bestAsset.costPerInstall)}.` });
  if (worstType) summaryCards.push({ cls: 'highlight-bad', title: 'Weakest Asset Type', text: `${worstType.type} with CPI ${fmtCurrency(worstType.cpi)}.` });
  summaryCards.push({ cls: '', title: 'Action Summary', text: `${stayAssets.length} assets to STAY, ${changeAssets.length} to CHANGE, ${pauseAssets.length} to PAUSE/REPLACE.` });
  if (placementAbove.length) summaryCards.push({ cls: 'highlight-bad', title: 'Guardrail Alert', text: `${placementAbove.length} placement(s) above guardrail: ${placementAbove.map(p => p.campaign + ' - ' + p.placement).join(', ')}.` });
  if (APP.wowResults && APP.wowResults.some(r => r.flags.length)) {
    const flagged = APP.wowResults.filter(r => r.flags.length);
    summaryCards.push({ cls: 'highlight-warn', title: 'WoW Alerts', text: `${flagged.length} asset(s) with major WoW changes detected.` });
  }

  execDiv.innerHTML = summaryCards.map(c => `
    <div class="summary-card ${c.cls}">
      <h4>${esc(c.title)}</h4>
      <p>${esc(c.text)}</p>
    </div>
  `).join('');

  // Asset Type Summary Table
  renderAssetTypeSummaryTable(typeDiv, allRows);

  // Action Plan Overview
  actionDiv.innerHTML = `
    <div class="action-group stay-group">
      <h4><span class="action-label stay">STAY</span> ${stayAssets.length} assets</h4>
      <ul>${stayAssets.slice(0, 10).map(a => `<li>${esc(a.asset)} (${esc(a.assetType)})</li>`).join('')}${stayAssets.length > 10 ? `<li>...and ${stayAssets.length - 10} more</li>` : ''}</ul>
    </div>
    <div class="action-group change-group">
      <h4><span class="action-label change">CHANGE</span> ${changeAssets.length} assets</h4>
      <ul>${changeAssets.slice(0, 10).map(a => `<li>${esc(a.asset)} (${esc(a.assetType)})</li>`).join('')}${changeAssets.length > 10 ? `<li>...and ${changeAssets.length - 10} more</li>` : ''}</ul>
    </div>
    <div class="action-group pause-group">
      <h4><span class="action-label pause">PAUSE / REPLACE</span> ${pauseAssets.length} assets</h4>
      <ul>${pauseAssets.slice(0, 10).map(a => `<li>${esc(a.asset)} (${esc(a.assetType)})</li>`).join('')}${pauseAssets.length > 10 ? `<li>...and ${pauseAssets.length - 10} more</li>` : ''}</ul>
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
    return { type, totalCost, totalImpr, totalClicks, totalInstalls, avgCTR, avgC2I, avgCPI, best, worst, count: items.length };
  }).sort((a, b) => b.totalCost - a.totalCost);

  container.innerHTML = `
    <div class="table-scroll">
      <table class="summary-table">
        <thead><tr>
          <th>Asset Type</th><th class="numeric">Assets</th><th class="numeric">Cost</th>
          <th class="numeric">Impr.</th><th class="numeric">Clicks</th><th class="numeric">CTR</th>
          <th class="numeric">Installs</th><th class="numeric">Click>Install%</th><th class="numeric">CPI</th>
          <th>Best Asset</th><th>Worst Asset</th>
        </tr></thead>
        <tbody>${summaryRows.map(r => `<tr>
          <td><strong>${esc(r.type)}</strong></td>
          <td class="numeric">${r.count}</td>
          <td class="numeric">${fmtCurrency(r.totalCost)}</td>
          <td class="numeric">${fmtNum(r.totalImpr)}</td>
          <td class="numeric">${fmtNum(r.totalClicks)}</td>
          <td class="numeric">${fmtPct(r.avgCTR)}</td>
          <td class="numeric">${fmtNum(r.totalInstalls)}</td>
          <td class="numeric">${fmtPct(r.avgC2I)}</td>
          <td class="numeric">${r.totalInstalls > 0 ? fmtCurrency(r.avgCPI) : '-'}</td>
          <td>${r.best ? esc(r.best.asset) : '-'}</td>
          <td>${r.worst ? esc(r.worst.asset) : '-'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  `;
}


// ============================================
// GUARDRAIL UI
// ============================================
function addGuardrailCampaign() {
  const container = document.getElementById('googleGuardrails');
  const template = document.getElementById('guardrailCampaignTemplate');
  const block = template.content.cloneNode(true);
  const div = block.querySelector('.guardrail-campaign-block');
  const id = crypto.randomUUID();
  div.dataset.id = id;

  const guardrail = { id, campaign: '', search: 70, gdn: 20, youtube: 15 };
  APP.guardrails.google.push(guardrail);

  div.querySelector('.guardrail-campaign-name').addEventListener('input', e => {
    guardrail.campaign = e.target.value;
  });
  div.querySelector('.g-search').addEventListener('change', e => {
    guardrail.search = Number(e.target.value);
  });
  div.querySelector('.g-gdn').addEventListener('change', e => {
    guardrail.gdn = Number(e.target.value);
  });
  div.querySelector('.g-youtube').addEventListener('change', e => {
    guardrail.youtube = Number(e.target.value);
  });
  div.querySelector('.remove-guardrail-btn').addEventListener('click', () => {
    APP.guardrails.google = APP.guardrails.google.filter(g => g.id !== id);
    div.remove();
  });

  container.appendChild(block);
}

// ============================================
// STATS
// ============================================
function updateStats() {
  document.getElementById('statFiles').textContent = APP.files.length;
  const totalRows = APP.files.reduce((s, f) => s + f.rows.length, 0);
  document.getElementById('statRows').textContent = totalRows.toLocaleString();
  const totalAssets = APP.googleRows.length + APP.metaRows.length;
  document.getElementById('statAssets').textContent = totalAssets;
}


// ============================================
// EXPORT
// ============================================
function handleExport(type) {
  let csvContent = '';
  let filename = 'export.csv';

  if (type === 'google') {
    csvContent = exportAnalysisCSV(APP.googleRows, APP.googleBenchmarks);
    filename = 'google_ads_analysis.csv';
  } else if (type === 'meta') {
    csvContent = exportAnalysisCSV(APP.metaRows, APP.metaBenchmarks);
    filename = 'meta_ads_analysis.csv';
  } else if (type === 'placement') {
    csvContent = exportPlacementCSV();
    filename = 'placement_analysis.csv';
  } else if (type === 'wow') {
    csvContent = exportWoWCSV();
    filename = 'wow_analysis.csv';
  } else if (type === 'all') {
    csvContent = exportAllCSV();
    filename = 'full_analysis_export.csv';
  }

  downloadCSV(csvContent, filename);
}

function exportAnalysisCSV(rows, benchmarks) {
  const headers = ['Channel','Campaign','Ad Group','Asset Type','Asset','Count','Cost','Impr.','Clicks','CTR','Click>Install%','Installs','Cost/Install','Action Plan'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      csvEscape(r.channel), csvEscape(r.campaign), csvEscape(r.adGroup),
      csvEscape(r.assetType), csvEscape(r.asset), r.count,
      r.cost.toFixed(2), r.impressions, r.clicks || 0,
      r.ctr !== null ? (r.ctr * 100).toFixed(2) + '%' : '',
      r.clickToInstall !== null ? (r.clickToInstall * 100).toFixed(2) + '%' : '',
      r.installs, r.installs > 0 ? r.costPerInstall.toFixed(2) : '',
      r.actionPlan
    ].join(','));
  }
  return lines.join('\n');
}

function exportPlacementCSV() {
  const allPlacements = [...(APP.placementGoogle || []), ...(APP.placementMeta || [])];
  const headers = ['Platform','Campaign','Placement','Cost','Impr.','Clicks','CTR','Click>Install%','Installs','Cost/Install','Cost Share','Guardrail Status'];
  const lines = [headers.join(',')];
  for (const p of allPlacements) {
    lines.push([
      p.platform === 'google' ? 'Google Ads' : 'Meta Ads',
      csvEscape(p.campaign), csvEscape(p.placement),
      p.cost.toFixed(2), p.impressions, p.clicks || 0,
      p.ctr !== null ? (p.ctr * 100).toFixed(2) + '%' : '',
      p.clickToInstall !== null ? (p.clickToInstall * 100).toFixed(2) + '%' : '',
      p.installs, p.installs > 0 ? p.costPerInstall.toFixed(2) : '',
      (p.costShare * 100).toFixed(2) + '%', p.guardrailStatus
    ].join(','));
  }
  return lines.join('\n');
}

function exportWoWCSV() {
  if (!APP.wowResults) return '';
  const headers = ['Platform','Campaign','Asset Type','Asset','Cost WoW','Impr WoW','Click WoW','CTR WoW','C2I WoW','Install WoW','CPI WoW','Flags'];
  const lines = [headers.join(',')];
  for (const r of APP.wowResults) {
    lines.push([
      r.platform, csvEscape(r.campaign), csvEscape(r.assetType), csvEscape(r.asset),
      r.wowCost !== null ? (r.wowCost * 100).toFixed(1) + '%' : '',
      r.wowImpr !== null ? (r.wowImpr * 100).toFixed(1) + '%' : '',
      r.wowClicks !== null ? (r.wowClicks * 100).toFixed(1) + '%' : '',
      r.wowCTR !== null ? (r.wowCTR * 100).toFixed(1) + '%' : '',
      r.wowC2I !== null ? (r.wowC2I * 100).toFixed(1) + '%' : '',
      r.wowInstalls !== null ? (r.wowInstalls * 100).toFixed(1) + '%' : '',
      r.wowCPI !== null ? (r.wowCPI * 100).toFixed(1) + '%' : '',
      csvEscape(r.flags.join('; '))
    ].join(','));
  }
  return lines.join('\n');
}

function exportAllCSV() {
  let content = '=== GOOGLE ADS ANALYSIS ===\n';
  content += exportAnalysisCSV(APP.googleRows, APP.googleBenchmarks);
  content += '\n\n=== META ADS ANALYSIS ===\n';
  content += exportAnalysisCSV(APP.metaRows, APP.metaBenchmarks);
  content += '\n\n=== PLACEMENT ANALYSIS ===\n';
  content += exportPlacementCSV();
  content += '\n\n=== WEEK-OVER-WEEK ===\n';
  content += exportWoWCSV();
  return content;
}

function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(val) {
  const s = String(val || '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}


// ============================================
// SAMPLE DATA
// ============================================
function loadSampleData() {
  clearAll();

  // Sample Google Ads data (with extra header rows like real exports)
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
YOUTUBE,tROAS,Video Audience,YouTube video,Success Story Interview,650,2.41%,"26,971","1,900,000",62,"30,645",9.54%`;

  // Sample Meta Ads data
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

  // Parse and add Google sample
  const gParsed = parseCSVSmart(googleCSV);
  APP.files.push({
    id: crypto.randomUUID(),
    name: 'sample-google-ads-week17.csv',
    platform: 'google',
    week: 'current',
    rawText: googleCSV,
    headers: gParsed.headers,
    rows: gParsed.rows,
    dateRange: { start: 'May 10, 2026', end: 'May 16, 2026' }
  });

  // Parse and add Meta sample
  const mParsed = parseCSVSmart(metaCSV);
  APP.files.push({
    id: crypto.randomUUID(),
    name: 'sample-meta-ads-week17.csv',
    platform: 'meta',
    week: 'current',
    rawText: metaCSV,
    headers: mParsed.headers,
    rows: mParsed.rows,
    dateRange: { start: '2026-05-10', end: '2026-05-16' }
  });

  // Add previous week sample for WoW demo
  const googlePrevCSV = `Asset details report
"May 3, 2026 - May 9, 2026"
segmentation_info.ad_network,Campaign,Ad group,Asset type,Asset,Clicks,CTR,Impr.,Cost,Installs,Cost / Install,Conv. rate (install)
SEARCH,Current Post Let,Jakarta Fresh Grads,Headline,Apply Now - Top Jobs,220,4.20%,"5,238","1,150,000",38,"30,263",17.27%
SEARCH,Current Post Let,Jakarta Fresh Grads,Headline,Find Your Dream Career,195,3.50%,"5,571","1,020,000",32,"31,875",16.41%
SEARCH,Current Post Let,Jakarta Fresh Grads,Description,Get hired in 7 days,290,4.80%,"6,042","1,380,000",50,"27,600",17.24%
YOUTUBE,Current Post Let,Video Watchers,YouTube video,Career Growth Reel 30s,820,2.72%,"30,147","1,950,000",72,"27,083",8.78%
SEARCH,tROAS,High Value Users,Headline,Premium Career Path,480,4.90%,"9,796","2,600,000",88,"29,545",18.33%
YOUTUBE,tROAS,Video Audience,YouTube video,Success Story Interview,600,2.30%,"26,087","1,800,000",55,"32,727",9.17%`;

  const gPrevParsed = parseCSVSmart(googlePrevCSV);
  APP.files.push({
    id: crypto.randomUUID(),
    name: 'sample-google-ads-week16.csv',
    platform: 'google',
    week: 'previous',
    rawText: googlePrevCSV,
    headers: gPrevParsed.headers,
    rows: gPrevParsed.rows,
    dateRange: { start: 'May 3, 2026', end: 'May 9, 2026' }
  });

  // Add guardrail config for demo
  APP.guardrails.google = [
    { id: crypto.randomUUID(), campaign: 'Current Post Let', search: 73.62, gdn: 12.90, youtube: 13.09 },
    { id: crypto.randomUUID(), campaign: 'tROAS', search: 65, gdn: 36, youtube: 8 }
  ];

  renderFilesList();
  renderGuardrailCampaigns();
  runAnalysis();
}

function renderGuardrailCampaigns() {
  const container = document.getElementById('googleGuardrails');
  container.innerHTML = '';
  for (const g of APP.guardrails.google) {
    const template = document.getElementById('guardrailCampaignTemplate');
    const block = template.content.cloneNode(true);
    const div = block.querySelector('.guardrail-campaign-block');
    div.dataset.id = g.id;
    div.querySelector('.guardrail-campaign-name').value = g.campaign;
    div.querySelector('.g-search').value = g.search;
    div.querySelector('.g-gdn').value = g.gdn;
    div.querySelector('.g-youtube').value = g.youtube;

    div.querySelector('.guardrail-campaign-name').addEventListener('input', e => { g.campaign = e.target.value; });
    div.querySelector('.g-search').addEventListener('change', e => { g.search = Number(e.target.value); });
    div.querySelector('.g-gdn').addEventListener('change', e => { g.gdn = Number(e.target.value); });
    div.querySelector('.g-youtube').addEventListener('change', e => { g.youtube = Number(e.target.value); });
    div.querySelector('.remove-guardrail-btn').addEventListener('click', () => {
      APP.guardrails.google = APP.guardrails.google.filter(x => x.id !== g.id);
      div.remove();
    });

    container.appendChild(block);
  }
}


// ============================================
// FORMAT HELPERS
// ============================================
function fmtCurrency(val) {
  if (!val && val !== 0) return '-';
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
}

function fmtNum(val) {
  if (val === null || val === undefined) return '-';
  return new Intl.NumberFormat('id-ID').format(Math.round(val));
}

function fmtPct(val) {
  if (val === null || val === undefined) return '-';
  return (val * 100).toFixed(2) + '%';
}

function esc(val) {
  return String(val || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
