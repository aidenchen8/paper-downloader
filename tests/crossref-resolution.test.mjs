import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseBestCrossrefMatch,
  extractDoiFromHtml,
  scoreCrossrefCandidate
} from "../scripts/lib/crossref.mjs";

test("extractDoiFromHtml prefers explicit DOI metadata", () => {
  const html = `
    <html>
      <head>
        <meta name="citation_doi" content="10.1016/j.memsci.2024.123456">
      </head>
      <body>
        <a href="https://doi.org/10.0000/ignored">Link</a>
      </body>
    </html>
  `;

  assert.equal(extractDoiFromHtml(html), "10.1016/j.memsci.2024.123456");
});

test("chooseBestCrossrefMatch prefers the closest title-author-year candidate", () => {
  const reference = {
    title: "Advanced membranes for electrochemistry",
    author: "Smith, A.; Chen, B.",
    journal: "Journal of Membrane Science",
    year: 2018,
    unstructured: "Smith, A.; Chen, B. 2018. Advanced membranes for electrochemistry. Journal of Membrane Science 555, 10-20."
  };

  const correct = {
    DOI: "10.1016/j.memsci.2018.123456",
    title: ["Advanced membranes for electrochemistry"],
    author: [{ family: "Smith", given: "A." }, { family: "Chen", given: "B." }],
    "container-title": ["Journal of Membrane Science"],
    created: { "date-parts": [[2018, 1, 1]] }
  };
  const wrong = {
    DOI: "10.1002/adma.202401234",
    title: ["Advanced materials for catalysis"],
    author: [{ family: "Rossi", given: "M." }],
    "container-title": ["Advanced Materials"],
    created: { "date-parts": [[2024, 1, 1]] }
  };

  assert.ok(scoreCrossrefCandidate(reference, correct) > scoreCrossrefCandidate(reference, wrong));
  assert.equal(chooseBestCrossrefMatch(reference, [wrong, correct])?.candidate?.DOI, correct.DOI);
});
