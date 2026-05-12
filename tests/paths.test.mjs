import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  buildProjectPaths,
  defaultUserDataDir,
  normalizeBrowserChannel,
  resolveOutputDir,
  sanitizeFilename,
  sanitizeProjectName,
  truncateFilenameStem
} from "../scripts/lib/paths.mjs";

test("sanitizeProjectName keeps DOI tail readable", () => {
  assert.equal(sanitizeProjectName("10.1021/jacs.5c05017"), "jacs.5c05017");
  assert.equal(sanitizeProjectName("10.1000/a:b/c"), "c");
});

test("sanitizeFilename removes cross-platform invalid characters", () => {
  assert.equal(sanitizeFilename('001_Lee:2016/"Nature"'), "001_Lee_2016_Nature");
  assert.equal(sanitizeFilename("CON"), "CON_file");
  assert.equal(sanitizeFilename("Paper title. "), "Paper title");
});

test("truncateFilenameStem trims long file names safely", () => {
  const longTitle = "A".repeat(220);
  assert.equal(truncateFilenameStem(longTitle, 180).length, 180);
});

test("resolveOutputDir follows DOI vs PDF defaults", () => {
  const fromDoi = resolveOutputDir({
    inputKind: "doi",
    inputPath: null,
    projectName: "jacs.5c05017",
    explicitOutputDir: "",
    cwd: "/tmp/work"
  });
  assert.equal(fromDoi, path.join("/tmp/work", "jacs.5c05017_refs"));

  const fromPdf = resolveOutputDir({
    inputKind: "document",
    inputPath: "/papers/sample paper.pdf",
    projectName: "ignored",
    explicitOutputDir: ""
  });
  assert.equal(fromPdf, path.join("/papers", "sample paper_refs"));
});

test("default user data dir switches by browser and platform", () => {
  assert.equal(normalizeBrowserChannel("edge"), "msedge");
  assert.equal(
    defaultUserDataDir("chrome", "darwin"),
    path.join(process.env.HOME || "", "Library", "Application Support", "Google", "Chrome")
  );
});

test("buildProjectPaths keeps files under project directory", () => {
  const paths = buildProjectPaths("/tmp/out", "jacs.5c05017");
  assert.equal(paths.projectDir, path.join("/tmp/out", "jacs.5c05017"));
  assert.equal(paths.rawRefsPath, path.join("/tmp/out", "jacs.5c05017", "refs_raw.json"));
});
