import test from "node:test";
import assert from "node:assert/strict";

import { extractDoiFromText, looksLikeDoi, normalizeDoi } from "../scripts/lib/doi.mjs";
import { detectPublisher, makeLabel, shortenJournal } from "../scripts/lib/publishers.mjs";

test("normalizeDoi strips DOI prefixes and trailing punctuation", () => {
  assert.equal(
    normalizeDoi("https://doi.org/10.1021/JACS.5C05017."),
    "10.1021/jacs.5c05017"
  );
  assert.equal(normalizeDoi("doi:10.1038/s41586-024-12345-6;"), "10.1038/s41586-024-12345-6");
});

test("extractDoiFromText finds DOI-like strings in free text", () => {
  assert.equal(
    extractDoiFromText('See paper at DOI 10.1002/adma.202401234 for details.'),
    "10.1002/adma.202401234"
  );
  assert.equal(looksLikeDoi("10.1016/j.memsci.2024.123456"), true);
  assert.equal(looksLikeDoi("not-a-doi"), false);
});

test("detectPublisher prefers DOI prefix and falls back to journal names", () => {
  assert.equal(detectPublisher("10.1021/jacs.5c05017", ""), "acs");
  assert.equal(detectPublisher("10.9999/example", "Advanced Materials"), "wiley");
  assert.equal(detectPublisher("10.3390/app142310811", "Applied Sciences"), "mdpi");
  assert.equal(detectPublisher("10.9999/example", "Heritage Science"), "nature");
  assert.equal(detectPublisher("10.9999/example", "Unknown Journal"), "unknown");
});

test("journal shortening and labels stay stable", () => {
  assert.equal(shortenJournal("Nature Energy"), "NatEnergy");
  assert.equal(makeLabel("Lee", 2016, "Nature Energy"), "Lee2016_NatEnergy");
});
