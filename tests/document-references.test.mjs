import test from "node:test";
import assert from "node:assert/strict";

import { extractReferencesFromDocumentText } from "../scripts/lib/document-references.mjs";

test("extractReferencesFromDocumentText finds numbered references and links", () => {
  const text = `
  Introduction

  Some body text.

  References
  [1] Lee, J., Wang, H. 2016. Efficient catalysts for water splitting. Nature Energy 1, 16012. https://doi.org/10.1038/nenergy.2016.12

  [2] Rossi, M. (2023). Materials discovery at scale. https://cris.unibo.it/handle/11585/947893

  [3] Smith, A.; Chen, B. 2018. Advanced membranes for electrochemistry. Journal of Membrane Science 555, 10-20.
  `;

  const references = extractReferencesFromDocumentText(text);
  assert.equal(references.length, 3);
  assert.equal(references[0].doi, "10.1038/nenergy.2016.12");
  assert.equal(references[1].links[0], "https://cris.unibo.it/handle/11585/947893");
  assert.match(references[2].title, /Advanced membranes/i);
  assert.equal(references[1].platform_hint, "");
  assert.equal(references[2].language, "en");
});

test("extractReferencesFromDocumentText parses Chinese references conservatively", () => {
  const text = `
  参考文献
  [1] 胡献忠.新版英国《国家科学教育课程标准》及其启示[J].全球教育展望,2001(03):44-49.

  [2] 张三, 李四. 面向制造业的数字化转型路径研究[J]. 工业工程与管理, 2022(04): 12-20. https://www.cqvip.com/qk/97011x/202204/7101234567.html
  `;

  const references = extractReferencesFromDocumentText(text);
  assert.equal(references.length, 2);
  assert.equal(references[0].language, "zh");
  assert.equal(references[0].reference_type, "J");
  assert.match(references[0].title, /国家科学教育课程标准/);
  assert.equal(references[1].platform_hint, "cqvip");
  assert.equal(references[1].article_url, "https://www.cqvip.com/qk/97011x/202204/7101234567.html");
});
