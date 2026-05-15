import test from "node:test";
import assert from "node:assert/strict";

import {
  buildArxivCandidates,
  buildPmcPdfCandidates,
  extractCandidatesFromEuropePmc,
  extractCandidatesFromOpenAlex,
  extractCandidatesFromSemanticScholar,
  extractCandidatesFromUnpaywall,
  isSafeDownloadUrl,
  rankOpenAccessCandidates
} from "../scripts/lib/open-access-resolver.mjs";

test("extractCandidatesFromUnpaywall prefers direct PDF locations", () => {
  const candidates = extractCandidatesFromUnpaywall({
    best_oa_location: {
      url_for_pdf: "https://repository.example.org/paper.pdf",
      url: "https://repository.example.org/paper",
      evidence: "oa repository"
    },
    oa_locations: [
      {
        url_for_pdf: "",
        url: "https://publisher.example.org/article"
      }
    ]
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source, "unpaywall");
  assert.equal(candidates[0].url, "https://repository.example.org/paper.pdf");
});

test("extractCandidatesFromOpenAlex reads best OA and location pdf_url fields", () => {
  const candidates = extractCandidatesFromOpenAlex({
    results: [
      {
        best_oa_location: {
          is_oa: true,
          pdf_url: "https://journal.example.org/open.pdf",
          landing_page_url: "https://journal.example.org/open",
          source: { display_name: "Example Journal" }
        },
        locations: [
          {
            is_oa: false,
            pdf_url: "https://closed.example.org/paywalled.pdf"
          }
        ]
      }
    ]
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source, "openalex");
  assert.equal(candidates[0].landingUrl, "https://journal.example.org/open");
});

test("extractCandidatesFromSemanticScholar returns openAccessPdf URL", () => {
  const candidates = extractCandidatesFromSemanticScholar({
    url: "https://www.semanticscholar.org/paper/example",
    openAccessPdf: {
      url: "https://pdfs.semanticscholar.org/aa/bb.pdf",
      status: "GREEN"
    }
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source, "semantic_scholar");
});

test("extractCandidatesFromEuropePmc includes full text URLs and PMCID fallbacks", () => {
  const candidates = extractCandidatesFromEuropePmc({
    resultList: {
      result: [
        {
          pmcid: "PMC3312970",
          fullTextUrlList: {
            fullTextUrl: [
              {
                url: "https://europepmc.org/articles/PMC3312970?pdf=render",
                documentStyle: "pdf",
                availability: "Open access"
              }
            ]
          }
        }
      ]
    }
  });

  assert.ok(candidates.some((candidate) => candidate.source === "europepmc"));
  assert.ok(candidates.some((candidate) => candidate.source === "pmc"));
});

test("buildArxivCandidates derives PDF URL from arXiv DOI and links", () => {
  assert.equal(
    buildArxivCandidates({ doi: "10.48550/arXiv.1706.03762" })[0]?.url,
    "https://arxiv.org/pdf/1706.03762.pdf"
  );
  assert.equal(
    buildArxivCandidates({ links: ["https://arxiv.org/abs/2401.01234"] })[0]?.url,
    "https://arxiv.org/pdf/2401.01234.pdf"
  );
  assert.equal(
    buildArxivCandidates({ links: ["https://arxiv.org/pdf/2401.01234.pdf"] })[0]?.url,
    "https://arxiv.org/pdf/2401.01234.pdf"
  );
});

test("rankOpenAccessCandidates deduplicates URLs and rejects unsafe hosts", () => {
  assert.equal(isSafeDownloadUrl("http://127.0.0.1/private.pdf"), false);
  assert.equal(isSafeDownloadUrl("https://repository.example.org/paper.pdf"), true);

  const ranked = rankOpenAccessCandidates([
    { source: "openalex", url: "https://repository.example.org/paper.pdf", priority: 20 },
    { source: "unpaywall", url: "https://repository.example.org/paper.pdf", priority: 10 },
    { source: "bad", url: "http://169.254.169.254/latest/meta-data", priority: 1 }
  ]);

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].source, "unpaywall");
});

test("buildPmcPdfCandidates ignores invalid PMCID values", () => {
  assert.equal(buildPmcPdfCandidates("not-a-pmcid").length, 0);
  assert.ok(buildPmcPdfCandidates("PMC3312970").length >= 2);
});
