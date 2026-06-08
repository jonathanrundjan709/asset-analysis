// Safe settings for non-engineering maintainers.
// Keep this file plain JavaScript so the dashboard remains a static site.
window.ASSET_ANALYSIS_CONFIG = {
  currency: {
    metaIdrToSgd: 13000
  },
  assetTypes: {
    google: [
      "Headline",
      "Description",
      "Horizontal Image",
      "Youtube Video",
      "HTML5"
    ],
    meta: [
      "Social Media",
      "KOL",
      "Job Listing"
    ]
  },
  guardrails: {
    google: {
      "Headline": { ctr: 0, clickToInstall: 0 },
      "Description": { ctr: 0, clickToInstall: 0 },
      "Horizontal Image": { ctr: 0, clickToInstall: 0 },
      "Youtube Video": { ctr: 0, clickToInstall: 0 },
      "HTML5": { ctr: 0, clickToInstall: 0 }
    },
    meta: {
      "KOL": { ctr: 0, clickToInstall: 0 },
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
