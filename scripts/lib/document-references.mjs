import fs from "node:fs/promises";
import path from "node:path";

import { extractDoiFromText, normalizeDoi } from "./doi.mjs";
import { sanitizeFilename } from "./paths.mjs";
import {
  detectPlatformFromLink,
  detectReferenceLanguage,
  detectReferenceType
} from "./reference-routing.mjs";

const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  ".pdf",
  ".txt",
  ".md",
  ".markdown",
  ".html",
  ".htm",
  ".docx",
  ".rtf"
]);

const REFERENCE_HEADINGS = [
  "references",
  "bibliography",
  "works cited",
  "literature cited",
  "reference",
  "reference list",
  "references cited",
  "参考文献",
  "文献",
  "文献列表",
  "推荐文献",
  "文献推荐",
  "推荐清单"
];

const URL_REGEX = /https?:\/\/[^\s<>"'\]]+(?:\([^\s<>"'\]]*\)[^\s<>"'\]]*)*/gi;

function looksLikeUrl(value = "") {
  return /^https?:\/\//i.test(String(value).trim());
}

function cleanupTrailingPunctuation(value = "") {
  const str = String(value);
  // 保留括号平衡的 URL（如 Cell Press S2405-8440(24)17017-X）
  const openParens = (str.match(/\(/g) || []).length;
  const closeParens = (str.match(/\)/g) || []).length;
  if (openParens > 0 && openParens === closeParens) {
    return str;
  }
  return str.replace(/[)\].,;:]+$/g, "");
}

function normalizeWhitespace(text = "") {
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function decodeHtmlEntities(text = "") {
  return String(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(html = "") {
  return decodeHtmlEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function extractLinks(text = "") {
  return Array.from(new Set(
    (String(text).match(URL_REGEX) || [])
      .map((item) => cleanupTrailingPunctuation(item))
      .filter(Boolean)
  ));
}

function extractLinksFromHtml(html = "") {
  const hrefs = [];
  const regex = /href=["']([^"'#]+)["']/gi;
  let match = regex.exec(String(html));
  while (match) {
    if (looksLikeUrl(match[1])) {
      hrefs.push(cleanupTrailingPunctuation(match[1]));
    }
    match = regex.exec(String(html));
  }
  return hrefs;
}

function trimReferenceMarker(value = "") {
  return String(value)
    .replace(/^\s*\[\d+\]\s*/, "")
    .replace(/^\s*\(\d+\)\s*/, "")
    .replace(/^\s*\d+[.)]\s*/, "")
    .trim();
}

function splitSentences(text = "") {
  return String(text)
    .split(/[。．]|(?:\.(?:\s+|$))/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 4);
}

function guessChineseReferenceMetadata(referenceText = "") {
  const stripped = trimReferenceMarker(
    String(referenceText)
      .replace(URL_REGEX, " ")
      .replace(/10\.\d{4,9}\/[^\s"'<>]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
  );

  const typeMatch = stripped.match(/\[([JDCMNRS])\]/i);
  const typeIndex = typeMatch ? stripped.indexOf(typeMatch[0]) : -1;
  const beforeType = typeIndex >= 0 ? stripped.slice(0, typeIndex).trim() : stripped;
  const afterType = typeIndex >= 0 ? stripped.slice(typeIndex + typeMatch[0].length).replace(/^[.。．,，:：\s]+/, "").trim() : "";
  const firstSeparatorIndex = beforeType.search(/[.。．]/);
  const author = firstSeparatorIndex >= 0 ? beforeType.slice(0, firstSeparatorIndex).trim() : "";
  const title = firstSeparatorIndex >= 0 ? beforeType.slice(firstSeparatorIndex + 1).trim() : beforeType;
  const yearMatch = afterType.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? Number.parseInt(yearMatch[0], 10) || 0 : 0;
  const journal = yearMatch
    ? afterType.slice(0, afterType.indexOf(yearMatch[0])).replace(/[，,；;:：]+$/g, "").trim()
    : afterType.split(/[，,]/)[0]?.trim() || "";

  return {
    author,
    title: title.replace(/\[[JDCMNRS]\]$/i, "").trim(),
    journal,
    year
  };
}

function guessReferenceMetadata(referenceText = "") {
  if (detectReferenceLanguage({ unstructured: referenceText }) === "zh") {
    const chineseMetadata = guessChineseReferenceMetadata(referenceText);
    if (chineseMetadata.title || chineseMetadata.author || chineseMetadata.journal) {
      return chineseMetadata;
    }
  }

  const stripped = trimReferenceMarker(
    String(referenceText)
      .replace(URL_REGEX, " ")
      .replace(/10\.\d{4,9}\/[^\s"'<>]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
  );

  const yearMatch = stripped.match(/\b(19|20)\d{2}[a-z]?\b/i);
  let authors = "";
  let title = "";
  let journal = "";
  let year = 0;

  if (yearMatch) {
    year = Number.parseInt(yearMatch[0], 10) || 0;
    const index = stripped.indexOf(yearMatch[0]);
    authors = stripped.slice(0, index).replace(/[(),]+$/g, "").trim();
    const tail = stripped.slice(index + yearMatch[0].length).replace(/^[).,\s-]+/, "").trim();
    const segments = splitSentences(tail);
    title = segments[0] || "";
    journal = segments[1] || "";
  } else {
    const segments = splitSentences(stripped);
    if (segments.length >= 3) {
      authors = segments[0];
      title = segments[1];
      journal = segments[2];
    } else if (segments.length === 2) {
      authors = segments[0];
      title = segments[1];
    } else {
      title = stripped;
    }
  }

  return {
    author: authors.trim(),
    title: title.trim(),
    journal: journal.trim(),
    year
  };
}

function findReferencesSection(text = "") {
  const normalized = normalizeWhitespace(text);
  const lines = normalized.split("\n");
  let lastHeadingIndex = -1;

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim().toLowerCase();
    // 1. 精确匹配
    if (REFERENCE_HEADINGS.includes(line)) {
      lastHeadingIndex = index;
      continue;
    }
    // 2. 模糊匹配：标题行包含关键词且较短
    if (line.length < 50 && REFERENCE_HEADINGS.some((h) => line.includes(h))) {
      lastHeadingIndex = index;
    }
  }

  if (lastHeadingIndex >= 0) {
    return lines.slice(lastHeadingIndex + 1).join("\n").trim();
  }

  const paragraphs = normalized.split(/\n\s*\n/).filter(Boolean);
  if (paragraphs.length >= 3) {
    // 检查是否整个文档就是编号引用列表
    const numberedCount = paragraphs.filter((p) => /^\d+[.)、]\s+/.test(p.trim())).length;
    if (numberedCount >= paragraphs.length * 0.5) {
      return normalized;
    }
    return paragraphs.slice(Math.max(0, Math.floor(paragraphs.length * 0.6))).join("\n\n");
  }

  return normalized;
}

function splitNumberedReferences(sectionText = "") {
  const matches = String(sectionText).match(
    /(?:^|\n)\s*(?:\[\d+\]|\(\d+\)|\d+[.)])\s+[\s\S]*?(?=(?:\n\s*(?:\[\d+\]|\(\d+\)|\d+[.)])\s+)|$)/g
  );
  return (matches || [])
    .map((entry) => trimReferenceMarker(normalizeWhitespace(entry)))
    .filter((entry) => entry.length >= 20);
}

function splitParagraphReferences(sectionText = "") {
  return String(sectionText)
    .split(/\n\s*\n/)
    .map((entry) => normalizeWhitespace(entry))
    .filter((entry) => entry.length >= 20);
}

function splitLineAccumulationReferences(sectionText = "") {
  const lines = String(sectionText)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const references = [];
  let current = "";

  const startsNewReference = (line) => (
    /^\[\d+\]\s+/.test(line) ||
    /^\(\d+\)\s+/.test(line) ||
    /^\d+[.)]\s+/.test(line) ||
    /^[A-Z][A-Za-z'`-]+,\s+[A-Z]/.test(line)
  );

  for (const line of lines) {
    if (!current) {
      current = line;
      continue;
    }

    if (startsNewReference(line) && current.length >= 40) {
      references.push(trimReferenceMarker(normalizeWhitespace(current)));
      current = line;
      continue;
    }

    current = `${current} ${line}`;
  }

  if (current) {
    references.push(trimReferenceMarker(normalizeWhitespace(current)));
  }

  return references.filter((entry) => entry.length >= 20);
}

function buildReferenceObjects(entries) {
  return entries.map((entry, index) => {
    const links = extractLinks(entry);
    const doiFromText = extractDoiFromText(entry);
    const doiFromLink = links
      .map((link) => normalizeDoi(link))
      .find((link) => /^10\.\d{4,9}\//.test(link)) || "";
    const metadata = guessReferenceMetadata(entry);
    const platformHint = links.map((link) => detectPlatformFromLink(link)).find(Boolean) || "";
    const language = detectReferenceLanguage({
      author: metadata.author,
      title: metadata.title,
      journal: metadata.journal,
      unstructured: entry
    });

    return {
      id: index + 1,
      doi: doiFromText || doiFromLink || null,
      raw_doi: doiFromText || doiFromLink || "",
      author: metadata.author,
      title: metadata.title,
      journal: metadata.journal,
      year: metadata.year,
      language,
      reference_type: detectReferenceType(entry),
      platform_hint: platformHint,
      article_url: links[0] || "",
      link: links[0] || "",
      links,
      unstructured: entry,
      extraction_method: "document_reference"
    };
  });
}

async function readPdfText(filePath) {
  const pdfParseModule = await import("pdf-parse");
  const pdfParse = pdfParseModule.default || pdfParseModule;
  const buffer = await fs.readFile(filePath);
  const parsed = await pdfParse(buffer);
  return {
    text: normalizeWhitespace(parsed?.text || ""),
    html: "",
    links: []
  };
}

async function readDocxText(filePath) {
  const mammothModule = await import("mammoth");
  const mammoth = mammothModule.default || mammothModule;
  const buffer = await fs.readFile(filePath);
  const [rawTextResult, htmlResult] = await Promise.all([
    mammoth.extractRawText({ buffer }),
    mammoth.convertToHtml({ buffer })
  ]);

  const html = htmlResult?.value || "";
  return {
    text: normalizeWhitespace(rawTextResult?.value || stripHtml(html)),
    html,
    links: extractLinksFromHtml(html)
  };
}

async function readHtmlText(filePath) {
  const html = await fs.readFile(filePath, "utf8");
  return {
    text: normalizeWhitespace(stripHtml(html)),
    html,
    links: extractLinksFromHtml(html)
  };
}

async function readPlainText(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return {
    text: normalizeWhitespace(text),
    html: "",
    links: extractLinks(text)
  };
}

export function isSupportedDocumentPath(filePath) {
  return SUPPORTED_DOCUMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export async function extractDocumentContent(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let payload;

  if (ext === ".pdf") {
    payload = await readPdfText(filePath);
  } else if (ext === ".docx") {
    payload = await readDocxText(filePath);
  } else if (ext === ".html" || ext === ".htm") {
    payload = await readHtmlText(filePath);
  } else if (SUPPORTED_DOCUMENT_EXTENSIONS.has(ext)) {
    payload = await readPlainText(filePath);
  } else {
    throw new Error(`Unsupported document type: ${filePath}`);
  }

  const mergedLinks = Array.from(new Set([
    ...payload.links,
    ...extractLinks(payload.text)
  ]));
  const sourceDoi = extractDoiFromText(payload.text.slice(0, 20_000));
  const lines = payload.text.split("\n").map((line) => line.trim()).filter(Boolean);
  const sourceTitle = lines.find((line) => line.length >= 12 && line.length <= 300) || sanitizeFilename(path.basename(filePath, ext));

  return {
    filePath,
    fileType: ext.slice(1),
    text: payload.text,
    html: payload.html,
    links: mergedLinks,
    sourceDoi,
    sourceTitle
  };
}

export function extractReferencesFromDocumentText(text) {
  const section = findReferencesSection(text);
  const numbered = splitNumberedReferences(section);
  if (numbered.length >= 2) {
    return buildReferenceObjects(numbered);
  }

  const paragraphs = splitParagraphReferences(section);
  if (paragraphs.length >= 2) {
    return buildReferenceObjects(paragraphs);
  }

  const accumulated = splitLineAccumulationReferences(section);
  return buildReferenceObjects(accumulated);
}

export async function extractReferencesFromDocument(filePath) {
  const content = await extractDocumentContent(filePath);
  const references = extractReferencesFromDocumentText(content.text);

  if (references.length === 0) {
    throw new Error(`Could not extract references from document: ${filePath}`);
  }

  return {
    source_doi: content.sourceDoi || null,
    source_title: content.sourceTitle,
    source_input: filePath,
    source_type: "document",
    extraction_mode: "document_references",
    file_type: content.fileType,
    reference_count: references.length,
    references
  };
}
