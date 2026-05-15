import net from "node:net";

import { normalizeDoi } from "./doi.mjs";
import { uniquePreserveOrder } from "./io.mjs";

const PLACEHOLDER_EMAIL = "your.email@example.com";
const API_TIMEOUT_MS = 20_000;
const DEFAULT_PROVIDERS = ["unpaywall", "openalex", "semantic_scholar", "europepmc", "arxiv"];
const SOURCE_PRIORITY = {
  unpaywall: 10,
  openalex: 20,
  semantic_scholar: 30,
  europepmc: 40,
  pmc: 45,
  arxiv: 50
};

const PRIVATE_IPV4_RANGES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^0\./
];

function cleanEmail(value = "") {
  const email = String(value || "").trim();
  if (!email || email.toLowerCase() === PLACEHOLDER_EMAIL) {
    return "";
  }
  return email;
}

function contactEmail(config = {}) {
  return cleanEmail(config.openAccess?.unpaywallEmail) || cleanEmail(config.crossref?.mailto) || "";
}

function buildUserAgent(config = {}) {
  const email = contactEmail(config);
  return email
    ? `paper-downloader/0.1 (mailto:${email})`
    : "paper-downloader/0.1";
}

function enabledProviders(config = {}) {
  const configured = Array.isArray(config.openAccess?.providers) && config.openAccess.providers.length > 0
    ? config.openAccess.providers
    : DEFAULT_PROVIDERS;
  return new Set(configured.map((item) => String(item).trim()).filter(Boolean));
}

function isPrivateIpLiteral(hostname = "") {
  const host = hostname.replace(/^\[|\]$/g, "");
  const family = net.isIP(host);
  if (family === 4) {
    return PRIVATE_IPV4_RANGES.some((pattern) => pattern.test(host));
  }
  if (family === 6) {
    const lowered = host.toLowerCase();
    return lowered === "::1" || lowered.startsWith("fc") || lowered.startsWith("fd") || lowered.startsWith("fe80");
  }
  return false;
}

export function isSafeDownloadUrl(rawUrl = "") {
  try {
    const url = new URL(String(rawUrl || "").trim());
    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }
    if (url.port && !["80", "443"].includes(url.port)) {
      return false;
    }
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "metadata.google.internal" ||
      hostname === "169.254.169.254" ||
      isPrivateIpLiteral(hostname)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function looksLikePdfUrl(rawUrl = "") {
  const lowered = String(rawUrl || "").toLowerCase();
  return (
    lowered.endsWith(".pdf") ||
    lowered.includes(".pdf?") ||
    lowered.includes("/pdf/") ||
    lowered.includes("/pdf?") ||
    lowered.includes("pdf=render") ||
    lowered.includes("blobtype=pdf") ||
    lowered.includes("download=1") ||
    lowered.includes("download=true")
  );
}

function addCandidate(candidates, candidate = {}) {
  const url = String(candidate.url || "").trim();
  if (!url || !isSafeDownloadUrl(url)) {
    return;
  }
  candidates.push({
    source: candidate.source || "unknown",
    url,
    landingUrl: candidate.landingUrl || "",
    evidence: candidate.evidence || "",
    version: candidate.version || "",
    priority: Number(candidate.priority || SOURCE_PRIORITY[candidate.source] || 999)
  });
}

async function fetchJson(url, config = {}, headers = {}) {
  const response = await fetch(url, {
    headers: {
      "user-agent": buildUserAgent(config),
      accept: "application/json",
      ...headers
    },
    redirect: "follow",
    signal: AbortSignal.timeout(API_TIMEOUT_MS)
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

export function extractCandidatesFromUnpaywall(payload = {}) {
  const candidates = [];
  const locations = [
    payload.best_oa_location,
    ...(Array.isArray(payload.oa_locations) ? payload.oa_locations : [])
  ].filter(Boolean);

  for (const [index, location] of locations.entries()) {
    const source = "unpaywall";
    const priority = SOURCE_PRIORITY[source] + index;
    addCandidate(candidates, {
      source,
      priority,
      url: location.url_for_pdf || "",
      landingUrl: location.url || "",
      evidence: location.evidence || "",
      version: location.version || ""
    });
    if (!location.url_for_pdf && looksLikePdfUrl(location.url || "")) {
      addCandidate(candidates, {
        source,
        priority: priority + 0.5,
        url: location.url,
        landingUrl: location.url,
        evidence: location.evidence || "",
        version: location.version || ""
      });
    }
  }
  return candidates;
}

export function extractCandidatesFromOpenAlex(payload = {}) {
  const work = Array.isArray(payload.results) ? payload.results[0] : payload;
  if (!work) {
    return [];
  }

  const candidates = [];
  const locations = [
    work.best_oa_location,
    ...(Array.isArray(work.locations) ? work.locations : [])
  ].filter(Boolean);

  for (const [index, location] of locations.entries()) {
    if (location.is_oa === false) {
      continue;
    }
    const source = "openalex";
    const priority = SOURCE_PRIORITY[source] + index;
    addCandidate(candidates, {
      source,
      priority,
      url: location.pdf_url || "",
      landingUrl: location.landing_page_url || "",
      evidence: location.source?.display_name || "",
      version: location.version || ""
    });
    if (!location.pdf_url && looksLikePdfUrl(location.landing_page_url || "")) {
      addCandidate(candidates, {
        source,
        priority: priority + 0.5,
        url: location.landing_page_url,
        landingUrl: location.landing_page_url,
        evidence: location.source?.display_name || "",
        version: location.version || ""
      });
    }
  }
  return candidates;
}

export function extractCandidatesFromSemanticScholar(payload = {}) {
  const candidates = [];
  const pdfUrl = payload.openAccessPdf?.url || "";
  addCandidate(candidates, {
    source: "semantic_scholar",
    url: pdfUrl,
    landingUrl: payload.url || "",
    evidence: payload.openAccessPdf?.status || "",
    priority: SOURCE_PRIORITY.semantic_scholar
  });
  return candidates;
}

export function buildPmcPdfCandidates(pmcid = "") {
  const normalized = String(pmcid || "").trim().replace(/^PMC/i, "");
  if (!/^\d+$/.test(normalized)) {
    return [];
  }
  const pmc = `PMC${normalized}`;
  return [
    {
      source: "pmc",
      url: `https://europepmc.org/articles/${pmc}?pdf=render`,
      landingUrl: `https://europepmc.org/articles/${pmc}`,
      evidence: "europe_pmc_render",
      priority: SOURCE_PRIORITY.pmc
    },
    {
      source: "pmc",
      url: `https://europepmc.org/backend/ptpmcrender.fcgi?accid=${pmc}&blobtype=pdf`,
      landingUrl: `https://europepmc.org/articles/${pmc}`,
      evidence: "europe_pmc_backend",
      priority: SOURCE_PRIORITY.pmc + 1
    },
    {
      source: "pmc",
      url: `https://pmc.ncbi.nlm.nih.gov/articles/${pmc}/pdf/`,
      landingUrl: `https://pmc.ncbi.nlm.nih.gov/articles/${pmc}/`,
      evidence: "ncbi_pmc_pdf",
      priority: SOURCE_PRIORITY.pmc + 2
    }
  ];
}

export function extractCandidatesFromEuropePmc(payload = {}) {
  const candidates = [];
  const results = payload.resultList?.result || [];
  for (const result of results) {
    const fullTextUrls = result.fullTextUrlList?.fullTextUrl || [];
    for (const [index, item] of fullTextUrls.entries()) {
      const url = item.url || "";
      const style = String(item.documentStyle || item.documentType || "").toLowerCase();
      if (style.includes("pdf") || looksLikePdfUrl(url)) {
        addCandidate(candidates, {
          source: "europepmc",
          url,
          landingUrl: result.fullTextUrl || "",
          evidence: item.availability || item.site || "",
          priority: SOURCE_PRIORITY.europepmc + index
        });
      }
    }
    for (const candidate of buildPmcPdfCandidates(result.pmcid || result.pmcId || "")) {
      addCandidate(candidates, candidate);
    }
  }
  return candidates;
}

export function buildArxivCandidates(reference = {}) {
  const candidates = [];
  const doi = normalizeDoi(reference.doi || "");
  const links = [
    reference.article_url,
    reference.link,
    ...(Array.isArray(reference.links) ? reference.links : [])
  ].filter(Boolean);

  let arxivId = "";
  const doiMatch = doi.match(/^10\.48550\/arxiv\.([^/]+)$/i);
  if (doiMatch?.[1]) {
    arxivId = doiMatch[1];
  }
  for (const link of links) {
    const match = String(link).match(/arxiv\.org\/(?:abs|pdf)\/([^?#/\s]+?)(?:\.pdf)?(?:[?#]|$)/i);
    if (match?.[1]) {
      arxivId = arxivId || match[1];
    }
  }

  if (arxivId) {
    addCandidate(candidates, {
      source: "arxiv",
      url: `https://arxiv.org/pdf/${arxivId}.pdf`,
      landingUrl: `https://arxiv.org/abs/${arxivId}`,
      evidence: "arxiv_identifier",
      priority: SOURCE_PRIORITY.arxiv
    });
  }
  return candidates;
}

export function rankOpenAccessCandidates(candidates = []) {
  const byUrl = new Map();
  for (const candidate of candidates) {
    if (!candidate?.url || !isSafeDownloadUrl(candidate.url)) {
      continue;
    }
    const existing = byUrl.get(candidate.url);
    if (!existing || Number(candidate.priority || 999) < Number(existing.priority || 999)) {
      byUrl.set(candidate.url, candidate);
    }
  }
  return Array.from(byUrl.values())
    .sort((left, right) => Number(left.priority || 999) - Number(right.priority || 999));
}

async function getUnpaywallCandidates(reference, config) {
  const email = contactEmail(config);
  if (!email) {
    return { candidates: [], warning: "unpaywall_email_missing" };
  }
  const doi = normalizeDoi(reference.doi || "");
  const url = new URL(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}`);
  url.searchParams.set("email", email);
  const payload = await fetchJson(url, config);
  return { candidates: payload ? extractCandidatesFromUnpaywall(payload) : [] };
}

async function getOpenAlexCandidates(reference, config) {
  const doi = normalizeDoi(reference.doi || "");
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("filter", `doi:https://doi.org/${doi}`);
  url.searchParams.set("per-page", "1");
  url.searchParams.set("select", "id,doi,display_name,open_access,best_oa_location,locations");
  if (config.openAccess?.openalexApiKey) {
    url.searchParams.set("api_key", config.openAccess.openalexApiKey);
  } else if (contactEmail(config)) {
    url.searchParams.set("mailto", contactEmail(config));
  }
  const payload = await fetchJson(url, config);
  return { candidates: payload ? extractCandidatesFromOpenAlex(payload) : [] };
}

async function getSemanticScholarCandidates(reference, config) {
  const doi = normalizeDoi(reference.doi || "");
  const url = new URL(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}`);
  url.searchParams.set("fields", "title,year,url,openAccessPdf,externalIds");
  const headers = {};
  if (config.openAccess?.semanticScholarApiKey) {
    headers["x-api-key"] = config.openAccess.semanticScholarApiKey;
  }
  const payload = await fetchJson(url, config, headers);
  return { candidates: payload ? extractCandidatesFromSemanticScholar(payload) : [] };
}

async function getEuropePmcCandidates(reference, config) {
  const doi = normalizeDoi(reference.doi || "");
  const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  url.searchParams.set("query", `DOI:"${doi}"`);
  url.searchParams.set("format", "json");
  url.searchParams.set("resultType", "core");
  url.searchParams.set("pageSize", "3");
  const payload = await fetchJson(url, config);
  return { candidates: payload ? extractCandidatesFromEuropePmc(payload) : [] };
}

export async function resolveOpenAccessCandidates(reference = {}, config = {}) {
  const doi = normalizeDoi(reference.doi || "");
  if (!doi || config.openAccess?.enabled === false) {
    return { candidates: [], errors: [], warnings: [] };
  }

  const providers = enabledProviders(config);
  const providerTasks = {
    unpaywall: getUnpaywallCandidates,
    openalex: getOpenAlexCandidates,
    semantic_scholar: getSemanticScholarCandidates,
    europepmc: getEuropePmcCandidates,
    arxiv: async () => ({ candidates: buildArxivCandidates(reference) })
  };

  const allCandidates = [];
  const errors = [];
  const warnings = [];
  for (const [provider, task] of Object.entries(providerTasks)) {
    if (!providers.has(provider)) {
      continue;
    }
    try {
      const result = await task(reference, config);
      allCandidates.push(...(result.candidates || []));
      if (result.warning) {
        warnings.push(`${provider}:${result.warning}`);
      }
    } catch (error) {
      errors.push(`${provider}:${String(error?.message || error)}`);
    }
  }

  return {
    candidates: rankOpenAccessCandidates(uniquePreserveOrder(allCandidates)),
    errors,
    warnings
  };
}
