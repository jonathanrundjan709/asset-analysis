# Maintenance Guide

This dashboard is a static HTML/CSS/JS tool for Performance Marketing CSV analysis. It is hosted on Vercel and should stay simple: no backend, no framework, no build step, and no new npm dependencies unless a developer confirms it is necessary.

## What the Performance Team Can Safely Update

Most routine changes should happen in `config.js`.

Safe updates:

- Meta IDR to SGD conversion rate: `currency.metaIdrToSgd`
- Meta content type options: `assetTypes.meta`
- Google Ads asset type labels used by guardrails: `assetTypes.google`
- Default guardrail categories and thresholds: `guardrails.google` and `guardrails.meta`
- Simple UI helper text in `uiText`

Guardrail values are stored as decimals in config:

- `0` means no fixed threshold
- `0.01` means 1%
- `0.05` means 5%

## What Requires Codex or Developer Help

Ask Codex or a developer for changes that involve:

- CSV parsing or support for new export formats
- New formulas or metric definitions
- Google Ads or Meta Ads detection rules
- Placement Analysis behavior
- Export CSV / Google Sheets behavior
- Visual layout or responsive design changes
- Any change outside `config.js` or documentation

## How to Request Changes

Use GitHub Issues for requests when possible. Include:

- What platform is affected: Google Ads, Meta Ads, or both
- Example CSV headers or a redacted sample CSV
- Expected metric or output
- Screenshot of the current issue
- Whether the change is urgent for a campaign decision

For Codex, paste the reusable prompt from `CODEX_PROMPT.md` and add the specific request below it.

## Deployment Flow

The repository should be connected to Vercel.

Recommended flow:

1. Create a new branch from `main`.
2. Make the change.
3. Open a Pull Request.
4. Wait for the Vercel Preview deployment.
5. Test the preview using `QA_CHECKLIST.md`.
6. Merge only after the preview looks correct.
7. Vercel deploys production from `main`.

## Main Branch Rule

Nobody should push directly to `main`.

All changes should go through a Pull Request and Vercel Preview before merge. This protects the team from breaking the production dashboard while testing CSV uploads or formula changes.
