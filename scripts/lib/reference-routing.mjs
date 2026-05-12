import { normalizeDoi } from "./doi.mjs";

const CJK_REGEX = /[\u3400-\u9fff]/u;
const REFERENCE_TYPE_REGEX = /\[([JDCMNRS])\]/i;
const YEAR_REGEX = /\b(19|20)\d{2}\b/;

export const CHINESE_PLATFORM_ORDER = ["wanfang", "cqvip", "cnki"];

const PLATFORM_HOST_TOKENS = {
  wanfang: ["wanfangdata.com.cn"],
  cqvip: ["cqvip.com"],
  cnki: ["cnki.net", "cnki.com.cn", "kns.cnki.net", "cbpt.cnki.net"]
};

function normalizeRawText(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

export function containsCjk(value = "") {
  return CJK_REGEX.test(String(value || ""));
}

export function normalizeLooseText(value = "") {
  return normalizeRawText(value)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/10\.\d{4,9}\/[^\s"'<>]+/gi, " ")
    .replace(/[《》〈〉“”"'`´]/g, " ")
    .replace(/[()（）\[\]【】{}]/g, " ")
    .replace(/[_/\\|,:;，；：。.!?！？~\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCompactText(value = "") {
  return normalizeLooseText(value)
    .replace(/[^\p{Letter}\p{Number}\u3400-\u9fff]+/gu, "")
    .trim();
}

function buildNgrams(value = "", size = 2) {
  const text = normalizeCompactText(value);
  if (!text) {
    return [];
  }
  if (text.length <= size) {
    return [text];
  }
  const grams = [];
  for (let index = 0; index <= text.length - size; index += 1) {
    grams.push(text.slice(index, index + size));
  }
  return grams;
}

function overlapRatio(leftItems = [], rightItems = []) {
  const left = new Set(leftItems.filter(Boolean));
  const right = new Set(rightItems.filter(Boolean));
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(left.size, right.size);
}

export function computeTitleSimilarity(left = "", right = "") {
  const normalizedLeft = normalizeCompactText(left);
  const normalizedRight = normalizeCompactText(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  const minLength = Math.min(normalizedLeft.length, normalizedRight.length);
  const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);
  if (
    minLength >= 8 &&
    (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
  ) {
    return 0.9 + Math.min(0.08, minLength / Math.max(1, maxLength * 10));
  }

  const gramSize = containsCjk(`${left}${right}`) ? 2 : 3;
  return overlapRatio(buildNgrams(normalizedLeft, gramSize), buildNgrams(normalizedRight, gramSize));
}

function splitAuthorParts(value = "") {
  return normalizeRawText(value)
    .replace(/\bet al\b/gi, "")
    .replace(/等$/u, "")
    .split(/(?:,|;|，|；|、| and | & | 和 )/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function extractAuthorTokens(value = "") {
  const tokens = [];
  for (const part of splitAuthorParts(value)) {
    if (containsCjk(part)) {
      const compact = normalizeCompactText(part);
      if (compact) {
        tokens.push(compact);
      }
      continue;
    }

    const words = normalizeLooseText(part).split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      continue;
    }

    const full = normalizeCompactText(words.join(" "));
    if (full) {
      tokens.push(full);
    }

    const family = normalizeCompactText(words.at(-1) || "");
    if (family) {
      tokens.push(family);
    }
  }

  return Array.from(new Set(tokens.filter((token) => token.length >= 2)));
}

export function computeAuthorMatch(referenceAuthors = "", candidateAuthors = []) {
  const referenceTokens = extractAuthorTokens(referenceAuthors);
  const candidateText = Array.isArray(candidateAuthors) ? candidateAuthors.join("; ") : String(candidateAuthors || "");
  const candidateTokens = extractAuthorTokens(candidateText);
  const hasReference = referenceTokens.length > 0;
  const hasCandidate = candidateTokens.length > 0;
  if (!hasReference || !hasCandidate) {
    return {
      score: 0,
      matched: 0,
      hasReference,
      hasCandidate,
      conflict: false
    };
  }

  const candidateSet = new Set(candidateTokens);
  const matched = referenceTokens.filter((token) => {
    for (const candidate of candidateSet) {
      if (candidate === token || candidate.includes(token) || token.includes(candidate)) {
        return true;
      }
    }
    return false;
  }).length;

  return {
    score: matched / referenceTokens.length,
    matched,
    hasReference,
    hasCandidate,
    conflict: matched === 0
  };
}

export function computeYearMatch(referenceYear = 0, candidateYear = 0) {
  const left = Number(referenceYear || 0);
  const right = Number(candidateYear || 0);
  if (!left || !right) {
    return {
      score: 0,
      exact: false,
      conflict: false,
      hasReference: Boolean(left),
      hasCandidate: Boolean(right)
    };
  }

  if (left === right) {
    return {
      score: 1,
      exact: true,
      conflict: false,
      hasReference: true,
      hasCandidate: true
    };
  }

  const delta = Math.abs(left - right);
  return {
    score: delta === 1 ? 0.5 : 0,
    exact: false,
    conflict: delta > 1,
    hasReference: true,
    hasCandidate: true
  };
}

export function detectReferenceType(value = "") {
  const match = String(value || "").match(REFERENCE_TYPE_REGEX);
  return match ? match[1].toUpperCase() : "";
}

export function detectReferenceLanguage(reference = {}) {
  const probe = [
    reference.language,
    reference.title,
    reference.journal,
    reference.author,
    reference.authors,
    reference.unstructured,
    reference.source_text
  ].filter(Boolean).join(" ");

  if (containsCjk(probe)) {
    return "zh";
  }
  if (/[A-Za-z]/.test(probe)) {
    return "en";
  }
  return "unknown";
}

export function detectPlatformFromLink(link = "") {
  const lowered = String(link || "").toLowerCase();
  if (!lowered.startsWith("http")) {
    return "";
  }

  for (const [platform, tokens] of Object.entries(PLATFORM_HOST_TOKENS)) {
    if (tokens.some((token) => lowered.includes(token))) {
      return platform;
    }
  }
  return "";
}

function firstPlatformLink(reference = {}) {
  const links = [
    reference.article_url,
    reference.link,
    ...(Array.isArray(reference.links) ? reference.links : [])
  ].filter(Boolean);
  for (const link of links) {
    if (detectPlatformFromLink(link)) {
      return link;
    }
  }
  return links[0] || "";
}

export function inferSourcePlatform(reference = {}) {
  return (
    detectPlatformFromLink(reference.article_url || "") ||
    detectPlatformFromLink(reference.link || "") ||
    (Array.isArray(reference.links)
      ? reference.links.map((link) => detectPlatformFromLink(link)).find(Boolean) || ""
      : "")
  );
}

export function buildChineseSearchQuery(reference = {}) {
  const title = String(reference.title || "").trim();
  if (title) {
    return title;
  }

  return [
    reference.author || reference.authors || "",
    reference.journal || "",
    reference.year || "",
    reference.unstructured || reference.source_text || ""
  ].find((item) => String(item || "").trim()) || "";
}

export function extractYearFromText(value = "") {
  const match = String(value || "").match(YEAR_REGEX);
  return match ? Number.parseInt(match[0], 10) : 0;
}

export function assessReferenceCandidate(reference = {}, candidate = {}) {
  const referenceTitle = reference.title || reference.source_text || reference.unstructured || "";
  const candidateTitle = candidate.title || candidate.label || candidate.text || "";
  const titleScore = computeTitleSimilarity(referenceTitle, candidateTitle);
  const exactTitle = normalizeCompactText(referenceTitle) === normalizeCompactText(candidateTitle);
  const doiMatch = Boolean(
    normalizeDoi(reference.doi || "") &&
    normalizeDoi(reference.doi || "") === normalizeDoi(candidate.doi || "")
  );
  const author = computeAuthorMatch(reference.authors || reference.author || "", candidate.authors || candidate.author || "");
  const year = computeYearMatch(reference.year || 0, candidate.year || extractYearFromText(candidate.text || ""));
  const hardConflict = author.conflict || year.conflict;
  const supportiveSignals = [
    doiMatch ? 1 : 0,
    author.score >= 0.5 ? 1 : 0,
    year.score >= 0.5 ? 1 : 0,
    candidate.download_ready ? 1 : 0
  ].reduce((sum, value) => sum + value, 0);

  const accepted = !hardConflict && (
    exactTitle ||
    titleScore >= 0.96 ||
    (titleScore >= 0.93 && supportiveSignals >= 1) ||
    (titleScore >= 0.9 && doiMatch)
  );

  const confidence = Number(((titleScore * 0.7) + (author.score * 0.2) + (year.score * 0.1)).toFixed(3));
  return {
    accepted,
    exactTitle,
    titleScore,
    doiMatch,
    authorScore: author.score,
    yearScore: year.score,
    confidence,
    reason: accepted
      ? "strict_match"
      : hardConflict
        ? "metadata_conflict"
        : "strict_match_not_met"
  };
}

export function finalizeReferenceRecord(rawReference = {}, validatedReference = {}) {
  const language = rawReference.language || validatedReference.language || detectReferenceLanguage({
    ...rawReference,
    ...validatedReference
  });
  const sourcePlatform = inferSourcePlatform(validatedReference) || inferSourcePlatform(rawReference) || "";
  const articleUrl = validatedReference.article_url || firstPlatformLink(validatedReference) || firstPlatformLink(rawReference) || "";
  const platformHint = rawReference.platform_hint || sourcePlatform;
  const routeFamily = sourcePlatform || language === "zh" ? "chinese_platform" : "english_doi";
  const preferredPlatforms = routeFamily === "chinese_platform"
    ? Array.from(new Set([sourcePlatform, platformHint, ...CHINESE_PLATFORM_ORDER].filter(Boolean)))
    : [];

  let status = validatedReference.status || "";
  if (
    routeFamily === "chinese_platform" &&
    ["no_doi", "failed"].includes(status) &&
    String(validatedReference.title || rawReference.title || rawReference.unstructured || "").trim()
  ) {
    status = "platform_search_pending";
  }

  return {
    ...validatedReference,
    language,
    reference_type: rawReference.reference_type || detectReferenceType(rawReference.unstructured || ""),
    platform_hint: platformHint,
    source_platform: sourcePlatform,
    article_url: articleUrl,
    route_family: routeFamily,
    preferred_platforms: preferredPlatforms,
    validation_error: validatedReference.error || "",
    status
  };
}
