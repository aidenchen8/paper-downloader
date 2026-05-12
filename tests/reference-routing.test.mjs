import test from "node:test";
import assert from "node:assert/strict";

import {
  assessReferenceCandidate,
  computeTitleSimilarity,
  detectPlatformFromLink,
  finalizeReferenceRecord
} from "../scripts/lib/reference-routing.mjs";

test("computeTitleSimilarity treats punctuation-only differences as exact enough", () => {
  assert.equal(
    computeTitleSimilarity("新版英国《国家科学教育课程标准》及其启示", "新版英国国家科学教育课程标准及其启示"),
    1
  );
});

test("detectPlatformFromLink recognizes Chinese literature platforms", () => {
  assert.equal(detectPlatformFromLink("https://www.wanfangdata.com.cn/details/detail.do?_type=perio&id=test"), "wanfang");
  assert.equal(detectPlatformFromLink("https://www.cqvip.com/qk/97011x/202204/7101234567.html"), "cqvip");
  assert.equal(detectPlatformFromLink("https://wgjn.cbpt.cnki.net/portal/journal/portal/client/paper/06585107a0d956e960f9d01e4ef9d441"), "cnki");
});

test("assessReferenceCandidate rejects title-only near misses with author conflict", () => {
  const reference = {
    title: "面向制造业的数字化转型路径研究",
    author: "张三, 李四",
    year: 2022,
    doi: ""
  };

  const candidate = {
    title: "面向制造业的数字化转型路径与策略研究",
    authors: ["王五", "赵六"],
    year: 2022,
    download_ready: true
  };

  const match = assessReferenceCandidate(reference, candidate);
  assert.equal(match.accepted, false);
  assert.equal(match.reason, "metadata_conflict");
});

test("finalizeReferenceRecord upgrades Chinese unresolved refs to platform search", () => {
  const rawReference = {
    id: 2,
    title: "面向制造业的数字化转型路径研究",
    author: "张三, 李四",
    language: "zh",
    link: "https://www.cqvip.com/qk/97011x/202204/7101234567.html",
    links: ["https://www.cqvip.com/qk/97011x/202204/7101234567.html"],
    reference_type: "J",
    unstructured: "张三, 李四. 面向制造业的数字化转型路径研究[J]. 工业工程与管理, 2022(04):12-20."
  };
  const validated = {
    id: 2,
    status: "no_doi",
    title: rawReference.title,
    error: "No DOI found in reference text, links, or Crossref search"
  };

  const finalized = finalizeReferenceRecord(rawReference, validated);
  assert.equal(finalized.route_family, "chinese_platform");
  assert.equal(finalized.status, "platform_search_pending");
  assert.equal(finalized.source_platform, "cqvip");
  assert.deepEqual(finalized.preferred_platforms, ["cqvip", "wanfang", "cnki"]);
});
