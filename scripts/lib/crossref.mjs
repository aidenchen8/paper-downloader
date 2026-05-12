import { normalizeDoi } from "./doi.mjs";
import { detectPublisher, makeLabel } from "./publishers.mjs";

const API_BASE = "https://api.crossref.org/works";
const DOI_REGEX = /10\.\d{4,9}\/[^\s"'<>]+/i;

function buildUserAgent(mailto) {
  const safeMailto = mailto || "unknown@example.com";
  return `paper-downloader/0.1 (mailto:${safeMailto})`;
}

function buildWorkUrl(doi, mailto) {
  const normalized = normalizeDoi(doi);
  const url = new URL(`${API_BASE}/${encodeURIComponent(normalized)}`);
  if (mailto && mailto !== "your.email@example.com") {
    url.searchParams.set("mailto", mailto);
  }
  return url.toString();
}

export function extractYear(message = {}) {
  for (const key of ["published-print", "published-online", "created"]) {
    const parts = message?.[key]?.["date-parts"];
    if (Array.isArray(parts) && Array.isArray(parts[0]) && parts[0][0]) {
      return Number(parts[0][0]) || 0;
    }
  }
  return 0;
}

function buildSearchUrl(reference, mailto) {
  const url = new URL(API_BASE);
  url.searchParams.set("rows", "5");
  url.searchParams.set("select", "DOI,title,author,container-title,published-print,published-online,created");

  const bibliographicQuery = reference.unstructured
    || [reference.title, reference.author, reference.journal, reference.year].filter(Boolean).join(" ");
  if (bibliographicQuery) {
    url.searchParams.set("query.bibliographic", bibliographicQuery);
  }
  if (mailto && mailto !== "your.email@example.com") {
    url.searchParams.set("mailto", mailto);
  }
  return url.toString();
}

function normalizeComparisonText(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/10\.\d{4,9}\/[^\s"'<>]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(text = "") {
  return normalizeComparisonText(text)
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function overlapScore(left = "", right = "") {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function extractAuthorTokens(authorText = "") {
  return tokenize(authorText).filter((token) => token.length >= 4).slice(0, 6);
}

function authorScore(referenceAuthor = "", candidateAuthors = []) {
  const referenceTokens = extractAuthorTokens(referenceAuthor);
  if (referenceTokens.length === 0 || !Array.isArray(candidateAuthors) || candidateAuthors.length === 0) {
    return 0;
  }

  const candidateTokens = new Set(
    candidateAuthors.flatMap((author) => extractAuthorTokens([
      author?.family,
      author?.given,
      author?.name
    ].filter(Boolean).join(" ")))
  );
  if (candidateTokens.size === 0) {
    return 0;
  }

  const matched = referenceTokens.filter((token) => candidateTokens.has(token)).length;
  return matched / referenceTokens.length;
}

function yearDistanceScore(referenceYear = 0, candidateYear = 0) {
  if (!referenceYear || !candidateYear) {
    return 0;
  }
  if (referenceYear === candidateYear) {
    return 1;
  }
  if (Math.abs(referenceYear - candidateYear) === 1) {
    return 0.4;
  }
  return 0;
}

export function extractDoiFromHtml(html = "") {
  const raw = String(html);
  const metaPatterns = [
    /<meta[^>]+name=["']citation_doi["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']dc\.identifier["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']dc\.identifier\.doi["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']prism\.doi["'][^>]+content=["']([^"']+)["']/i
  ];

  for (const pattern of metaPatterns) {
    const match = raw.match(pattern);
    if (!match) {
      continue;
    }
    const doi = normalizeDoi(match[1]);
    if (DOI_REGEX.test(doi)) {
      return doi;
    }
  }

  const doiUrlMatch = raw.match(/https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/[^\s"'<>]+)/i);
  if (doiUrlMatch) {
    return normalizeDoi(doiUrlMatch[1]);
  }

  const textMatch = raw.match(DOI_REGEX);
  return textMatch ? normalizeDoi(textMatch[0]) : "";
}

export async function fetchCrossrefWork(doi, mailto) {
  const response = await fetch(buildWorkUrl(doi, mailto), {
    headers: {
      "user-agent": buildUserAgent(mailto),
      accept: "application/json"
    },
    signal: AbortSignal.timeout(30_000)
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Crossref request failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  return json.message || null;
}

export async function fetchCrossrefSearch(reference, mailto) {
  const response = await fetch(buildSearchUrl(reference, mailto), {
    headers: {
      "user-agent": buildUserAgent(mailto),
      accept: "application/json"
    },
    signal: AbortSignal.timeout(30_000)
  });

  if (!response.ok) {
    throw new Error(`Crossref search failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  return Array.isArray(json?.message?.items) ? json.message.items : [];
}

function normalizeRawReference(reference, index) {
  const rawDoi = reference?.DOI || reference?.doi || "";
  return {
    id: index,
    doi: normalizeDoi(rawDoi) || null,
    raw_doi: rawDoi || "",
    author: reference?.author || reference?.["first-author"] || "",
    title: reference?.["article-title"] || reference?.["volume-title"] || "",
    journal: reference?.["journal-title"] || "",
    year: Number(reference?.year || 0) || 0,
    unstructured: reference?.unstructured || reference?.["article-title"] || ""
  };
}

export async function extractReferencesForDoi(doi, mailto) {
  const message = await fetchCrossrefWork(doi, mailto);
  if (!message) {
    throw new Error(`DOI not found in Crossref: ${doi}`);
  }

  const references = Array.isArray(message.reference)
    ? message.reference.map((reference, index) => normalizeRawReference(reference, index + 1))
    : [];

  if (references.length === 0) {
    throw new Error(`Crossref returned no references for DOI: ${doi}`);
  }

  return {
    doi: normalizeDoi(message.DOI || doi),
    title: Array.isArray(message.title) ? message.title[0] || "" : "",
    references
  };
}

export function scoreCrossrefCandidate(reference, candidate) {
  const candidateTitle = Array.isArray(candidate?.title) ? candidate.title[0] || "" : "";
  const candidateJournal = Array.isArray(candidate?.["container-title"]) ? candidate["container-title"][0] || "" : "";
  const candidateYear = extractYear(candidate);

  const titleBase = reference.title || reference.unstructured || "";
  const title = overlapScore(titleBase, candidateTitle);
  const authors = authorScore(reference.author || "", candidate.author || []);
  const journal = overlapScore(reference.journal || "", candidateJournal);
  const year = yearDistanceScore(reference.year || 0, candidateYear);

  return (title * 0.55) + (authors * 0.2) + (journal * 0.1) + (year * 0.15);
}

export function chooseBestCrossrefMatch(reference, candidates = []) {
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCrossrefCandidate(reference, candidate)
    }))
    .sort((left, right) => right.score - left.score);

  if (ranked.length === 0) {
    return null;
  }

  const [best, second] = ranked;
  if (!best?.candidate?.DOI) {
    return null;
  }

  if (best.score >= 0.45) {
    return best;
  }
  if (best.score >= 0.3 && (!second || best.score - second.score >= 0.12)) {
    return best;
  }
  return null;
}

export async function resolveDoiFromLink(link, fetchImpl = fetch) {
  const normalizedLink = String(link || "").trim();
  if (!normalizedLink) {
    return "";
  }

  const direct = normalizeDoi(normalizedLink);
  if (DOI_REGEX.test(direct)) {
    return direct;
  }

  const response = await fetchImpl(normalizedLink, {
    headers: {
      "user-agent": buildUserAgent("unknown@example.com"),
      accept: "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000)
  });

  const finalUrlDoi = normalizeDoi(response.url || "");
  if (DOI_REGEX.test(finalUrlDoi)) {
    return finalUrlDoi;
  }

  const text = await response.text();
  return extractDoiFromHtml(text);
}

export async function searchCrossrefForReference(reference, mailto) {
  const candidates = await fetchCrossrefSearch(reference, mailto);
  const best = chooseBestCrossrefMatch(reference, candidates);
  if (!best) {
    return null;
  }
  return {
    doi: normalizeDoi(best.candidate.DOI),
    score: best.score,
    title: Array.isArray(best.candidate.title) ? best.candidate.title[0] || "" : "",
    journal: Array.isArray(best.candidate["container-title"]) ? best.candidate["container-title"][0] || "" : "",
    year: extractYear(best.candidate)
  };
}

export async function resolveReferenceDoi(reference, mailto) {
  const provided = normalizeDoi(reference.doi || "");
  if (DOI_REGEX.test(provided)) {
    return {
      doi: provided,
      source: "reference_doi",
      error: ""
    };
  }

  for (const link of reference.links || []) {
    try {
      const doi = await resolveDoiFromLink(link);
      if (DOI_REGEX.test(doi)) {
        return {
          doi,
          source: "reference_link",
          matched_link: link,
          error: ""
        };
      }
    } catch {
      // keep trying other links and then Crossref search
    }
  }

  try {
    const match = await searchCrossrefForReference(reference, mailto);
    if (match?.doi) {
      return {
        doi: match.doi,
        source: "crossref_search",
        match_score: match.score,
        matched_title: match.title,
        error: ""
      };
    }
  } catch {
    // if Crossref search errors, fall through to the no-doi result
  }

  return {
    doi: null,
    source: "",
    error: "No DOI found in reference text, links, or Crossref search"
  };
}

export async function enrichReference(reference, mailto) {
  const resolution = await resolveReferenceDoi(reference, mailto);
  if (!resolution.doi) {
    return {
      id: reference.id,
      doi: null,
      status: "no_doi",
      label: `Ref${String(reference.id).padStart(2, "0")}_NoDOI`,
      title: reference.title || reference.unstructured || "",
      authors: reference.author || "",
      year: reference.year || 0,
      journal: reference.journal || "",
      publisher: "unknown",
      link: reference.link || "",
      links: reference.links || [],
      source_text: reference.unstructured || "",
      resolution_source: "",
      error: resolution.error
    };
  }

  const message = await fetchCrossrefWork(resolution.doi, mailto);
  if (!message) {
    return {
      id: reference.id,
      doi: resolution.doi,
      status: "failed",
      label: `Ref${String(reference.id).padStart(2, "0")}_UnverifiedDOI`,
      title: reference.title || "",
      authors: reference.author || "",
      year: reference.year || 0,
      journal: reference.journal || "",
      publisher: detectPublisher(resolution.doi, reference.journal || ""),
      link: reference.link || "",
      links: reference.links || [],
      source_text: reference.unstructured || "",
      resolution_source: resolution.source,
      error: `DOI not found in Crossref: ${resolution.doi}`
    };
  }

  const authors = Array.isArray(message.author) ? message.author : [];
  const firstAuthor = authors[0]?.family || authors[0]?.name || "Unknown";
  const allAuthors = authors
    .slice(0, 5)
    .map((author) => [author.family, author.given].filter(Boolean).join(" ").trim())
    .filter(Boolean)
    .join(", ");
  const journal = Array.isArray(message["container-title"]) ? message["container-title"][0] || "" : "";
  const year = extractYear(message);
  const publisher = detectPublisher(reference.doi, journal);

  return {
    id: reference.id,
    doi: normalizeDoi(resolution.doi),
    status: "verified",
    label: makeLabel(firstAuthor, year, journal),
    title: Array.isArray(message.title) ? message.title[0] || "" : "",
    authors: allAuthors,
    year,
    journal,
    publisher,
    link: reference.link || "",
    links: reference.links || [],
    source_text: reference.unstructured || "",
    resolution_source: resolution.source,
    error: ""
  };
}
