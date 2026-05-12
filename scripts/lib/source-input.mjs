import fs from "node:fs/promises";
import path from "node:path";

import { looksLikeDoi, normalizeDoi } from "./doi.mjs";
import { extractDocumentContent, isSupportedDocumentPath } from "./document-references.mjs";
import { pathExists } from "./io.mjs";

export async function resolveInputSource(inputValue) {
  const input = String(inputValue).trim();

  if (looksLikeDoi(input)) {
    return {
      inputKind: "doi",
      doi: normalizeDoi(input),
      inputPath: null,
      sourceDoi: normalizeDoi(input),
      sourceTitle: ""
    };
  }

  const absolutePath = path.resolve(input);
  if (!(await pathExists(absolutePath))) {
    throw new Error(`Input is neither a DOI nor an existing supported document: ${input}`);
  }

  const stats = await fs.stat(absolutePath);
  if (!stats.isFile()) {
    throw new Error(`Expected a DOI or a document file, got directory: ${absolutePath}`);
  }
  if (!isSupportedDocumentPath(absolutePath)) {
    throw new Error(`Unsupported document type: ${absolutePath}`);
  }

  const content = await extractDocumentContent(absolutePath);
  return {
    inputKind: "document",
    doi: content.sourceDoi || null,
    inputPath: absolutePath,
    sourceDoi: content.sourceDoi || null,
    sourceTitle: content.sourceTitle,
    fileType: content.fileType
  };
}
