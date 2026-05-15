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

test("extractReferencesFromDocumentText parses recommendation-list documents with titles and links", () => {
  const text = `
  数字文化资产与人工智能结合——文献推荐清单

  一、数据集与 Benchmark 类文章

  1. Datasheets for Digital Cultural Heritage Datasets (2023)

  作者: H Alkemade, S Claeyssens, G Colavizza et al.

  期刊/会议: Journal of Open Humanities Data (JOHD) | 被引: 53次

  提出了数字文化遗产数据集的“数据表”标准化框架。

  https://cris.unibo.it/handle/11585/947893

  2. Artificial Intelligence for Dunhuang Cultural Heritage Protection: The Project and the Dataset (2022)

  作者: T Yu, C Lin, S Zhang, C Wang, X Ding, H An et al.

  期刊/会议: International Journal of Computer Vision (IJCV) — Springer | 被引: 102次

  顶级计算机视觉期刊，发布了敦煌文化遗产保护的大规模数据集。

  https://link.springer.com/article/10.1007/s11263-022-01665-x
  `;

  const references = extractReferencesFromDocumentText(text);
  assert.equal(references.length, 2);
  assert.equal(references[0].title, "Datasheets for Digital Cultural Heritage Datasets");
  assert.equal(references[0].author, "H Alkemade, S Claeyssens, G Colavizza et al.");
  assert.equal(references[0].journal, "Journal of Open Humanities Data (JOHD)");
  assert.equal(references[0].article_url, "https://cris.unibo.it/handle/11585/947893");
  assert.equal(references[1].doi, "10.1007/s11263-022-01665-x");
  assert.equal(references[1].year, 2022);
  assert.equal(references[1].extraction_method, "document_recommendation");
});
