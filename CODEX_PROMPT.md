# Codex Prompt Template

Use this template when asking Codex to update the dashboard.

```text
You are maintaining this repository:
https://github.com/jonathanrundjan709/asset-analysis

This is a static HTML/CSS/JS dashboard for Performance Marketing CSV analysis.

Rules:
- Do not push directly to main.
- Create a new branch and open a Pull Request.
- Do not rewrite the whole app.
- Do not add a framework, backend, build step, or npm dependency unless absolutely necessary.
- Keep existing Google Ads and Meta Ads behavior working.
- Preserve support for old CSV column names.
- Do not change formulas unless explicitly requested.
- Keep deployment compatible with Vercel static hosting.
- Explain every changed file.
- Mention what should be tested in the Vercel Preview.

Request:
[Describe the exact change here.]

Helpful context:
- Platform affected: [Google Ads / Meta Ads / both]
- Example CSV headers:
[Paste headers or a redacted sample]
- Expected output:
[Describe expected dashboard behavior]
```

Before merge, test the Pull Request's Vercel Preview with `QA_CHECKLIST.md`.
