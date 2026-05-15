---
name: paper-downloader
description: >
  Use when the user asks to batch-download all references for a paper from a
  DOI or uploaded document and wants to reuse an existing Chrome or Edge login session,
  especially institutional access on macOS or Windows. Trigger on phrases like
  "下载这篇论文的全部参考文献", "batch download references", "download all refs",
  "用浏览器登录态下载文献", or when the user provides a DOI/document and asks for
  all cited PDFs, including mixed Chinese/English reference lists. Do not use for one-off PDF downloads, paper search, or Zotero import.
---

# paper-downloader

`<SKILL_DIR>` = this folder. The implementation lives under `scripts/`.

## Capabilities

- Default browser is `chrome`.
- Browser login reuse works on both macOS and Windows through the real Chrome or Edge user profile.
- Three-stage flow: `extract refs` -> `validate refs` -> `download refs`.
- The current scope focuses on **main reference PDFs**.
- DOI input and local document input are both supported.
- Supported document types: `pdf`, `docx`, `txt`, `md`, `html`, `htm`, `rtf`.
- For document input, the skill first extracts the reference list from the document itself.
- DOI resolution order per reference: existing DOI -> article link -> Crossref search from citation text.
- English DOI references use an OA-first chain before browser automation: Unpaywall -> OpenAlex -> Semantic Scholar -> Europe PMC/PMC -> arXiv.
- English references fall back to the DOI/publisher route only after OA candidates fail.
- Chinese references follow a conservative platform route: direct article link -> `wanfang` -> `cqvip` -> `cnki`.
- Mixed Chinese/English reference lists can be processed in one run.
- Failed items do not stop the batch; the skill writes both row-level and summary-level failure reports.
- The real Chrome/Edge profile is launched lazily only when OA/direct routes cannot download a verified PDF.
- Once the browser context is open, candidate PDFs are first fetched through the same BrowserContext request session before clicking page controls.
- Background runs create a manual intervention queue so humans only handle blocked or judgment-heavy references.
- School SSO and browser challenges can be handled interactively in the real browser window. Do not bypass CAPTCHA, Cloudflare, or publisher access controls.

## Install prerequisites

Before first use:

```bash
cd "<SKILL_DIR>"
npm install
cp config.example.json config.local.json
```

Then edit `config.local.json`:

- Set `crossref.mailto` to a real email.
- Optionally set `openAccess.unpaywallEmail`; if left blank, the skill reuses `crossref.mailto`.
- Leave `browser.channel` as `chrome` unless the user explicitly wants Edge.
- If the user does not use the default browser profile, set `browser.profileDirectory`.
- If Chrome or Edge stores profile data in a non-default location, set `browser.userDataDir`.

## When to invoke

Use this skill when:

- The user wants all references of a paper downloaded from a DOI.
- The user gives a local document and wants the cited papers downloaded.
- The user explicitly mentions browser login state, school network, institutional access, SSO, Chrome, or Edge.

Do not use this skill when:

- The user wants only one PDF.
- The user is searching for papers rather than downloading a known paper's references.
- The user wants Zotero import or bibliography formatting.

## Primary entry

```bash
node "<SKILL_DIR>/scripts/run-paper-downloader.mjs" <DOI_OR_DOCUMENT_PATH>
```

Useful flags:

- `--browser chrome|msedge`
- `--profile <profile-name>`
- `--user-data-dir <path>`
- `--output-dir <path>`
- `--yes` to skip the confirmation prompt
- `--auto` to avoid waiting for manual login/captcha handling and mark such refs as `manual_pending`
- `--oa-only` or `--skip-browser` to resolve only publicly available OA PDFs and never launch the browser
- `--no-oa` to disable the OA resolver for debugging
- `--publisher-direct-fetch` to opt into publisher direct fetch after OA misses and before browser fallback
- `--no-authenticated-direct-fetch` to disable BrowserContext cookie-sharing PDF requests
- `--no-manual-queue` to skip writing `manual_intervention.md` and `manual_intervention_queue.json`

## Pre-flight checklist

Before running:

1. Confirm the DOI is correct.
2. If the input is a document, confirm it actually contains a reference list or bibliography section.
3. Ask the user to fully close Chrome or Edge first. Persistent profile launch needs exclusive access.
4. Confirm `config.local.json` exists and `crossref.mailto` is not the placeholder.
5. For OA-heavy batches, prefer an initial `--oa-only` run to avoid unnecessary RPA.
6. Tell the user that a real browser window may open for institutional login or anti-bot checks only for refs that lack public PDFs.
7. For long unattended batches, prefer `--yes --auto`; review `manual_intervention.md` afterward and rerun once the user has handled the blocked pages.

## Output layout

```text
<OUTPUT_DIR>/
├── <PROJECT_NAME>/
│   ├── refs_raw.json
│   ├── refs_validated.json
│   ├── download_report.csv
│   ├── download_summary.json
│   ├── manual_intervention.md
│   ├── manual_intervention_queue.json
│   ├── project_meta.json
│   └── *.pdf
└── runs/
    └── <timestamp>-round-01/
        ├── events.jsonl
        └── downloads/
```

## Manual handling rules

- If the downloader lands on a school login page or browser challenge page, it will pause and ask the user to finish it in the real browser window.
- If the user wants a non-interactive run, use `--auto`; those refs become `manual_pending` instead of blocking the whole run.
- In non-interactive runs, read `manual_intervention.md` before asking the user to retry; it contains the exact refs, source links, reasons, and suggested human actions.
- Do not ask the user to manually inject cookies. The downloader may reuse the authorized browser context via Playwright's shared request session, but it must not export, forge, or bypass cookies.
- Do not attempt to solve, bypass, hide from, or defeat CAPTCHA/Cloudflare/anti-bot systems. Reduce challenge frequency by using OA-first resolution, conservative delays, and browser fallback only when needed.
- Re-running is incremental enough for day-to-day use because existing PDFs are skipped automatically.
- If a reference has no DOI, the validator will try article links first, then a Crossref bibliographic search.
- Chinese-platform candidates are validated conservatively before download; if title/author/year evidence is not strong enough, the skill should skip the item and report why.
- If a Chinese platform only exposes `CAJ` and there is no stable PDF path, the skill should report that case instead of saving an incorrect file type.

## Common failure modes

- Browser launch fails immediately:
  Chrome or Edge is probably still open and holding the profile lock.
- DOI cannot be extracted from a local document:
  If the input is meant to be treated as a source paper DOI, ask the user for the DOI manually. If it is a reference-bearing document, the skill can still proceed by extracting references from the document text.
- Many refs become `manual_pending`:
  Usually institution SSO or bot checks; re-run interactively and complete the prompts in the browser window.
- `Crossref request failed`:
  Check network access and the configured `crossref.mailto`.
- Few or no refs are extracted from a document:
  The document may not have a clean references section in extracted text; try a text-based PDF or a docx/html version.
- Many Chinese refs fail with `strict_match_not_met`:
  The extracted citation text may be too noisy, or the platform result did not match strongly enough. Do not loosen this check unless the user explicitly wants a riskier strategy.

## Manual stage entrypoints

```bash
node "<SKILL_DIR>/scripts/extract-refs.mjs" <DOI>
node "<SKILL_DIR>/scripts/validate-refs.mjs" <PROJECT_DIR>
node "<SKILL_DIR>/scripts/download-refs.mjs" <PROJECT_DIR>
```

See also:

- [README.md](README.md)
- [references/agent-runbook.md](references/agent-runbook.md)
