import test from "node:test";
import assert from "node:assert/strict";

import {
  buildManualInterventionQueue,
  renderManualInterventionMarkdown
} from "../scripts/lib/browser-downloader.mjs";

test("manual intervention queue keeps only human-actionable rows", () => {
  const queue = buildManualInterventionQueue([
    {
      id: 1,
      pdf_status: "downloaded",
      title: "Downloaded paper",
      pdf_file: "Downloaded paper.pdf"
    },
    {
      id: 2,
      pdf_status: "manual_pending",
      notes: "institution_auth_redirect",
      title: "Institutional paper",
      doi: "10.1000/example",
      source_url: "https://library.example/login",
      target_pdf_file: "Institutional paper.pdf"
    },
    {
      id: 3,
      pdf_status: "failed_auto",
      notes: "strict_match_not_met",
      title: "Needs review",
      article_url: "https://example.org/article"
    },
    {
      id: 4,
      pdf_status: "failed_auto",
      notes: "browser_fallback_disabled_for_chinese_platform",
      title: "Skipped by OA-only mode"
    }
  ]);

  assert.equal(queue.length, 2);
  assert.equal(queue[0].kind, "blocked");
  assert.equal(queue[0].suggested_action.includes("institutional login"), true);
  assert.equal(queue[1].kind, "review");
});

test("manual intervention markdown includes source links and rerun guidance", () => {
  const markdown = renderManualInterventionMarkdown([
    {
      id: 7,
      kind: "blocked",
      status: "manual_pending",
      reason: "browser_challenge",
      title: "A paper title",
      doi: "10.1000/example",
      source_url: "",
      article_url: "",
      suggested_action: "Complete the visible human verification in the browser, then rerun the downloader."
    }
  ], "2026-05-15T00:00:00.000Z");

  assert.match(markdown, /Manual Intervention Queue/);
  assert.match(markdown, /https:\/\/doi\.org\/10\.1000\/example/);
  assert.match(markdown, /Existing PDFs are skipped automatically/);
});
