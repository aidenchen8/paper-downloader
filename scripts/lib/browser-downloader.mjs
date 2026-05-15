import fs from "node:fs/promises";
import path from "node:path";

import {
  appendJsonl,
  ensureDir,
  nowIso,
  promptLine,
  sleep,
  uniquePreserveOrder,
  writeCsv,
  writeJson
} from "./io.mjs";
import { resolveOpenAccessCandidates } from "./open-access-resolver.mjs";
import {
  buildArticleUrl,
  buildDirectPdfUrl,
  getPdfSelectors,
  getPublisherStrategy,
  VIEWER_DOWNLOAD_SELECTORS
} from "./publishers.mjs";
import { resolveBrowserRuntime, sanitizeFilename, truncateFilenameStem } from "./paths.mjs";
import {
  assessReferenceCandidate,
  buildChineseSearchQuery,
  CHINESE_PLATFORM_ORDER,
  computeTitleSimilarity,
  extractYearFromText,
  inferSourcePlatform
} from "./reference-routing.mjs";

const NAV_TIMEOUT_MS = 15_000;
const LOADING_WAIT_MS = 20_000;
const ARTIFACT_WAIT_MS = 1_800;
const CLICK_WAIT_MS = 1_400;
const MAX_CAPTURE_DEPTH = 2;
const MIN_PDF_BYTES = 10_000;

const HUMAN_REVIEW_STATUSES = new Set([
  "manual_pending",
  "failed_auto",
  "failed_exception",
  "no_doi"
]);

const LOW_VALUE_REVIEW_REASONS = new Set([
  "ignored",
  "browser_fallback_disabled_for_chinese_platform"
]);

const CAPTCHA_SELECTORS = [
  "#px-captcha",
  "div.cf-turnstile",
  "#cf-challenge-running",
  ".cf-browser-verification",
  "#challenge-form",
  "iframe[src*='hcaptcha']",
  "iframe[src*='recaptcha']"
];

const CHALLENGE_URL_TOKENS = [
  "captcha",
  "challenge",
  "cf_chl",
  "turnstile",
  "px-captcha"
];

const CHALLENGE_TEXT_TOKENS = [
  "cloudflare",
  "verify you are human",
  "just a moment",
  "security check",
  "attention required",
  "please enable cookies",
  "access denied",
  "request rejected",
  "support id",
  "radware",
  "request verification: in progress"
];

const CHINESE_PLATFORM_CONFIGS = {
  wanfang: {
    homeUrl: "https://www.wanfangdata.com.cn/",
    hostTokens: ["wanfangdata.com.cn"],
    searchInputSelectors: [
      'input[placeholder*="标题"]',
      'input[placeholder*="关键词"]',
      'input[placeholder*="请输入"]',
      'input[type="search"]',
      'input[type="text"]'
    ],
    searchButtonSelectors: [
      'button:has-text("学术搜索")',
      'button:has-text("检索")',
      'button:has-text("搜索")',
      '[role="button"]:has-text("学术搜索")',
      '[role="button"]:has-text("检索")',
      '[role="button"]:has-text("搜索")'
    ],
    articleUrlTokens: ["/details/detail", "/paper/", "/periodical/", "/searchdetail/"],
    downloadSelectors: [
      'a:has-text("下载全文")',
      'a:has-text("下载PDF")',
      'a:has-text("PDF下载")',
      'button:has-text("下载全文")',
      'button:has-text("PDF下载")',
      'button:has-text("下载")'
    ]
  },
  cqvip: {
    homeUrl: "https://www.cqvip.com/",
    hostTokens: ["cqvip.com"],
    searchInputSelectors: [
      'input[placeholder*="检索词"]',
      'input[placeholder*="请输入"]',
      'input[type="search"]',
      'input[type="text"]'
    ],
    searchButtonSelectors: [
      'button:has-text("检索")',
      'button:has-text("搜索")',
      '[role="button"]:has-text("检索")',
      '[role="button"]:has-text("搜索")'
    ],
    articleUrlTokens: ["/qk/", "/journal/", "/detail", "/article/"],
    downloadSelectors: [
      'a:has-text("下载")',
      'a:has-text("PDF")',
      'button:has-text("下载")',
      'button:has-text("PDF")'
    ]
  },
  cnki: {
    homeUrl: "https://www.cnki.net/",
    hostTokens: ["cnki.net", "cnki.com.cn", "cbpt.cnki.net", "kns.cnki.net"],
    searchInputSelectors: [
      'input[placeholder*="关键词"]',
      'input[placeholder*="检索"]',
      'input[placeholder*="请输入"]',
      'input[type="search"]',
      'input[type="text"]'
    ],
    searchButtonSelectors: [
      'button:has-text("检索")',
      'button:has-text("搜索")',
      '[role="button"]:has-text("检索")',
      '[role="button"]:has-text("搜索")',
      'a:has-text("检索")'
    ],
    articleUrlTokens: ["/paper/", "/article/", "/detail", "/portal/journal/portal/client/paper/"],
    downloadSelectors: [
      'a:has-text("下载本文")',
      'a:has-text("下载")',
      'a:has-text("PDF")',
      'button:has-text("下载本文")',
      'button:has-text("PDF")'
    ]
  }
};

function kbFromBytes(bytes = 0) {
  return Math.max(1, Math.round(Number(bytes || 0) / 1024));
}

function isPdfLikeUrl(url = "") {
  const lowered = String(url).toLowerCase();
  return (
    lowered.endsWith(".pdf") ||
    lowered.includes("/pdf") ||
    lowered.includes("pdfdirect") ||
    lowered.includes("pdfft") ||
    lowered.includes("viewmedia") ||
    lowered.includes("download=true")
  );
}

function isPdfContentType(contentType = "") {
  return String(contentType).toLowerCase().includes("pdf");
}

function isExternalHttpUrl(url = "") {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname.endsWith(".localhost") ||
      hostname === "metadata.google.internal" ||
      hostname === "169.254.169.254"
    ) {
      return false;
    }
    if (/^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^169\.254\./.test(hostname)) {
      return false;
    }
    const private172 = hostname.match(/^172\.(\d+)\./);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isRealPdfBody(body) {
  if (!body || body.length < 5) return false;
  const header = body.slice(0, 5).toString("ascii");
  return header === "%PDF-";
}

async function closePageQuietly(page) {
  try {
    if (page && !page.isClosed()) {
      await page.close();
    }
  } catch {
    // best effort
  }
}

function formatRunStamp(date = new Date()) {
  return date.toISOString().replace(/[:T]/g, "-").slice(0, 19);
}

async function createRunLogger(runsRoot) {
  await ensureDir(runsRoot);
  let runDir = path.join(runsRoot, `${formatRunStamp()}-round-01`);
  let suffix = 2;
  while (true) {
    try {
      await fs.mkdir(runDir, { recursive: false });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      runDir = path.join(runsRoot, `${formatRunStamp()}-round-01-${String(suffix).padStart(2, "0")}`);
      suffix += 1;
    }
  }
  const eventsPath = path.join(runDir, "events.jsonl");
  return {
    runDir,
    eventsPath,
    async log(ref, stage, status, url, details = "") {
      await appendJsonl(eventsPath, {
        at: nowIso(),
        ref_id: ref?.id ?? null,
        doi: ref?.doi ?? "",
        label: ref?.label ?? "",
        publisher: ref?.publisher ?? "",
        stage,
        status,
        url,
        details
      });
    }
  };
}

function preferredPdfStem(ref) {
  const titleStem = truncateFilenameStem(ref.title || "", 180);
  if (titleStem) {
    return titleStem;
  }

  const labelStem = truncateFilenameStem(ref.label || "", 120);
  if (labelStem) {
    return labelStem;
  }

  return `ref_${String(ref.id || 0).padStart(3, "0")}`;
}

async function chooseOutputFilename(projectDir, ref, usedFileNames) {
  const baseStem = preferredPdfStem(ref);
  let attempt = 0;

  while (attempt < 1000) {
    const suffix = attempt === 0 ? "" : ` (${attempt + 1})`;
    const stemBudget = Math.max(40, 180 - suffix.length);
    const stem = truncateFilenameStem(baseStem, stemBudget) || `ref_${String(ref.id || 0).padStart(3, "0")}`;
    const fileName = `${sanitizeFilename(stem)}${suffix}.pdf`;

    if (usedFileNames.has(fileName)) {
      attempt += 1;
      continue;
    }

    try {
      await fs.access(path.join(projectDir, fileName));
      usedFileNames.add(fileName);
      return {
        fileName,
        alreadyExists: true
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      usedFileNames.add(fileName);
      return {
        fileName,
        alreadyExists: false
      };
    }
  }

  const fallback = `ref_${String(ref.id || 0).padStart(3, "0")}.pdf`;
  usedFileNames.add(fallback);
  return {
    fileName: fallback,
    alreadyExists: false
  };
}

function buildReportRow(ref, extra = {}) {
  const strategy = getPublisherStrategy(ref.publisher || "unknown");
  return {
    id: ref.id,
    doi: ref.doi || "",
    label: ref.label || "",
    publisher: ref.publisher || "unknown",
    year: ref.year || 0,
    journal: ref.journal || "",
    title: ref.title || "",
    language: ref.language || "",
    route_family: ref.route_family || "",
    source_platform: ref.source_platform || "",
    resolution_source: ref.resolution_source || "",
    publisher_strategy: strategy.family,
    publisher_support: strategy.support,
    oa_source: "",
    pdf_file: "",
    target_pdf_file: "",
    pdf_status: "",
    download_format: "",
    pdf_size_kb: "",
    article_url: ref.article_url || ref.link || "",
    source_url: "",
    match_confidence: "",
    notes: "",
    updated_at: nowIso(),
    ...extra
  };
}

function buildPdfHints(url) {
  const lowered = String(url).toLowerCase();
  return (
    isPdfLikeUrl(lowered) ||
    lowered.includes("stamp.jsp") ||
    lowered.includes("articlepdf") ||
    lowered.includes("download?")
  );
}

function derivePdfUrlsFromArticleUrl(articleUrl = "", ref = {}, publisher = "unknown") {
  const url = String(articleUrl || "").trim();
  if (!url.startsWith("http")) {
    return [];
  }

  const normalized = url.replace(/[?#].*$/, "").replace(/\/$/, "");
  const candidates = [];

  if (/mdpi\.com\//i.test(normalized)) {
    candidates.push(`${normalized}/pdf`);
  }
  if (/nature\.com\/articles\//i.test(normalized)) {
    candidates.push(`${normalized}.pdf`);
  }
  if (/link\.springer\.com\/article\//i.test(normalized)) {
    candidates.push(normalized.replace("/article/", "/content/pdf/") + ".pdf");
  }
  if (/aclanthology\.org\//i.test(normalized)) {
    candidates.push(`${normalized}.pdf`);
  }
  if (/arxiv\.org\/abs\//i.test(normalized)) {
    candidates.push(normalized.replace("/abs/", "/pdf/") + ".pdf");
  }
  if (/openaccess\.thecvf\.com\/content\//i.test(normalized) && /\/html\//i.test(normalized)) {
    candidates.push(
      normalized
        .replace("/html/", "/papers/")
        .replace(/\.html$/i, ".pdf")
    );
  }
  if (/dl\.acm\.org\/doi\/abs\//i.test(normalized)) {
    candidates.push(normalized.replace("/doi/abs/", "/doi/pdf/"));
  }
  if (/dl\.acm\.org\/doi\//i.test(normalized)) {
    candidates.push(normalized.replace("/doi/", "/doi/pdf/"));
  }
  if (/ieeexplore\.ieee\.org\/(?:abstract\/)?document\/(\d+)/i.test(normalized)) {
    const match = normalized.match(/ieeexplore\.ieee\.org\/(?:abstract\/)?document\/(\d+)/i);
    if (match?.[1]) {
      candidates.push(`https://ieeexplore.ieee.org/stamp/stamp.jsp?arnumber=${match[1]}`);
    }
  }
  if (/sciencedirect\.com\/science\/article\/pii\/([A-Z0-9]+)/i.test(normalized)) {
    const match = normalized.match(/sciencedirect\.com\/science\/article\/pii\/([A-Z0-9]+)/i);
    if (match?.[1]) {
      candidates.push(`https://www.sciencedirect.com/science/article/pii/${match[1]}/pdfft?isDTMRedir=true&download=true`);
    }
  }
  if (/cell\.com\/heliyon\/fulltext\//i.test(normalized)) {
    const pii = normalized.split("/").pop() || "";
    const compactPii = pii.replace(/[^A-Za-z0-9]/g, "");
    if (compactPii) {
      candidates.push(`https://www.sciencedirect.com/science/article/pii/${compactPii}/pdfft?isDTMRedir=true&download=true`);
    }
  }
  if (publisher === "emerald" && ref.doi) {
    candidates.push(`https://www.emerald.com/insight/content/doi/${ref.doi}/full/pdf`);
  }

  return uniquePreserveOrder(candidates.filter(Boolean));
}

async function tryDirectPdfFetch({ ref, url, destPath, logger }) {
  if (!url) {
    return null;
  }
  if (!isExternalHttpUrl(url)) {
    await logger.log(ref, "direct_fetch", "blocked", url, "unsafe_or_non_http_url");
    return null;
  }

  try {
    await logger.log(ref, "direct_fetch", "start", url, "");
    const response = await fetch(url, {
      headers: {
        "user-agent": "paper-downloader/0.1",
        accept: "application/pdf,application/octet-stream;q=0.9,text/html;q=0.8,*/*;q=0.7"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(45_000)
    });

    if (!response.ok) {
      await logger.log(ref, "direct_fetch", "failed", url, `${response.status} ${response.statusText}`);
      return null;
    }

    const body = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "";
    if (!isRealPdfBody(body)) {
      await logger.log(ref, "direct_fetch", "failed", response.url || url, `non_pdf_content_type:${contentType}`);
      return null;
    }
    if (body.length < MIN_PDF_BYTES) {
      await logger.log(ref, "direct_fetch", "failed", response.url || url, `pdf_too_small:${body.length}`);
      return null;
    }

    await fs.writeFile(destPath, body);
    const stats = await fs.stat(destPath);
    await logger.log(ref, "direct_fetch", "downloaded", response.url || url, `${kbFromBytes(stats.size)}kb`);
    return {
      state: "downloaded",
      sourceUrl: response.url || url,
      sizeKb: kbFromBytes(stats.size)
    };
  } catch (error) {
    await logger.log(ref, "direct_fetch", "failed", url, String(error?.message || error));
    return null;
  }
}

async function tryContextPdfFetch({ context, ref, url, referer = "", destPath, logger }) {
  if (!url) {
    return null;
  }
  if (!isExternalHttpUrl(url)) {
    await logger.log(ref, "context_fetch", "blocked", url, "unsafe_or_non_http_url");
    return null;
  }

  try {
    await logger.log(ref, "context_fetch", "start", url, referer ? `referer=${referer}` : "");
    const headers = {
      accept: "application/pdf,application/octet-stream;q=0.9,text/html;q=0.8,*/*;q=0.7"
    };
    if (referer && isExternalHttpUrl(referer)) {
      headers.referer = referer;
    }

    const response = await context.request.get(url, {
      headers,
      timeout: 45_000,
      failOnStatusCode: false
    });

    if (!response.ok()) {
      await logger.log(ref, "context_fetch", "failed", url, `${response.status()} ${response.statusText()}`);
      return null;
    }

    const body = await response.body();
    const contentType = response.headers()["content-type"] || "";
    const finalUrl = typeof response.url === "function" ? response.url() : url;
    if (!isRealPdfBody(body)) {
      await logger.log(ref, "context_fetch", "failed", finalUrl || url, `non_pdf_content_type:${contentType}`);
      return null;
    }
    if (body.length < MIN_PDF_BYTES) {
      await logger.log(ref, "context_fetch", "failed", finalUrl || url, `pdf_too_small:${body.length}`);
      return null;
    }

    await fs.writeFile(destPath, body);
    const stats = await fs.stat(destPath);
    await logger.log(ref, "context_fetch", "downloaded", finalUrl || url, `${kbFromBytes(stats.size)}kb`);
    return {
      state: "downloaded",
      sourceUrl: finalUrl || url,
      sizeKb: kbFromBytes(stats.size)
    };
  } catch (error) {
    await logger.log(ref, "context_fetch", "failed", url, String(error?.message || error));
    return null;
  }
}

function attachArtifactCollector(page) {
  let firstPdfBody = null;
  let firstPdfUrl = "";
  let firstDownload = null;
  let consumed = false;

  const onResponse = async (response) => {
    if (consumed || firstPdfBody || firstDownload) {
      return;
    }
    try {
      const contentType = response.headers()["content-type"] || "";
      if (!response.ok()) {
        return;
      }
      if (!isPdfContentType(contentType) && !buildPdfHints(response.url())) {
        return;
      }
      const body = await response.body();
      if (body && body.length >= MIN_PDF_BYTES && isRealPdfBody(body)) {
        firstPdfBody = body;
        firstPdfUrl = response.url();
      }
    } catch {
      // ignore transient response-body errors
    }
  };

  const onDownload = (download) => {
    if (!consumed && !firstDownload) {
      firstDownload = download;
    }
  };

  page.on("response", onResponse);
  page.on("download", onDownload);

  return {
    async persist(destPath) {
      if (consumed) {
        return null;
      }
      if (firstDownload) {
        consumed = true;
        await firstDownload.saveAs(destPath);
        const checkBuf = Buffer.alloc(5);
        const fd = await fs.open(destPath, "r");
        try {
          await fd.read(checkBuf, 0, 5, 0);
        } finally {
          await fd.close();
        }
        const stats = await fs.stat(destPath);
        if (!isRealPdfBody(checkBuf) || stats.size < MIN_PDF_BYTES) {
          await fs.unlink(destPath).catch(() => {});
          return null;
        }
        return {
          state: "downloaded",
          sourceUrl: typeof firstDownload.url === "function" ? firstDownload.url() : page.url(),
          sizeKb: kbFromBytes(stats.size)
        };
      }
      if (firstPdfBody) {
        consumed = true;
        await fs.writeFile(destPath, firstPdfBody);
        const stats = await fs.stat(destPath);
        return {
          state: "downloaded",
          sourceUrl: firstPdfUrl || page.url(),
          sizeKb: kbFromBytes(stats.size)
        };
      }
      return null;
    },
    async waitAndPersist(destPath, timeoutMs = ARTIFACT_WAIT_MS) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const saved = await this.persist(destPath);
        if (saved) {
          return saved;
        }
        await sleep(200);
      }
      return null;
    },
    dispose() {
      page.off("response", onResponse);
      page.off("download", onDownload);
    }
  };
}

async function pageSnapshot(page) {
  try {
    return await page.evaluate(() => ({
      title: document.title || "",
      bodyText: (document.body?.innerText || "").slice(0, 4000)
    }));
  } catch {
    return { title: "", bodyText: "" };
  }
}

async function hasVisibleCaptcha(page) {
  for (const selector of CAPTCHA_SELECTORS) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.count()) {
        if (await locator.isVisible()) {
          return true;
        }
      }
    } catch {
      // ignore flaky selectors
    }
  }
  return false;
}

async function waitThroughLoadingPage(page, institution) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < LOADING_WAIT_MS) {
    const title = (await page.title().catch(() => "")) || "";
    const lowered = title.toLowerCase();
    const matchesInstitutionLoading = institution.authLoadingTitles.some((item) => lowered.includes(String(item).toLowerCase()));
    const isGenericLoading = lowered === "" || lowered === "loading..." || lowered.includes("请稍候") || lowered.includes("please wait");
    if (!matchesInstitutionLoading && !isGenericLoading) {
      return;
    }
    await page.waitForTimeout(500);
  }
}

async function inspectBarrier(page, institution) {
  const url = (page.url() || "").toLowerCase();
  if (institution.authHosts.some((host) => url.includes(String(host).toLowerCase()))) {
    return { reason: "institution_auth_redirect", url: page.url() };
  }
  if (institution.authUrlFragments.some((fragment) => url.includes(String(fragment).toLowerCase()))) {
    return { reason: "institution_auth_redirect", url: page.url() };
  }

  const snapshot = await pageSnapshot(page);
  const title = String(snapshot.title || "").toLowerCase();
  const bodyText = String(snapshot.bodyText || "").toLowerCase();

  if (institution.authPageTitles.some((item) => title.includes(String(item).toLowerCase()))) {
    return { reason: "institution_auth_redirect", url: page.url() };
  }
  if (
    CHALLENGE_URL_TOKENS.some((token) => url.includes(token)) ||
    CHALLENGE_TEXT_TOKENS.some((token) => title.includes(token) || bodyText.includes(token))
  ) {
    return { reason: "browser_challenge", url: page.url() };
  }
  if (await hasVisibleCaptcha(page)) {
    return { reason: "captcha_dom_detected", url: page.url() };
  }
  return null;
}

async function resolveBarrier(page, institution, auto) {
  let barrier = await inspectBarrier(page, institution);
  if (!barrier) {
    return { action: "continue" };
  }
  if (auto) {
    return { action: "manual_pending", reason: barrier.reason, url: barrier.url };
  }

  while (barrier) {
    process.stdout.write(`       需要人工处理：${barrier.reason}\n`);
    process.stdout.write("       在打开的浏览器中完成学校登录或验证码后，回到终端继续。\n");
    const answer = await promptLine("       回车重试，输入 s 跳过当前文献，输入 q 终止整个任务: ");
    if (/^q$/i.test(answer)) {
      throw new Error("Download aborted by user");
    }
    if (/^s$/i.test(answer)) {
      return { action: "manual_pending", reason: barrier.reason, url: barrier.url };
    }
    await waitThroughLoadingPage(page, institution);
    barrier = await inspectBarrier(page, institution);
  }

  return { action: "continue" };
}

async function safeGoto(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  } catch (error) {
    const message = String(error?.message || error);
    if (!message.includes("ERR_ABORTED") || !page.url()) {
      throw error;
    }
  }
  await page.waitForTimeout(500);
}

async function collectCandidateUrls(page, publisher) {
  const urls = [];
  for (const selector of getPdfSelectors(publisher).slice(0, 10)) {
    try {
      const found = await page.locator(selector).evaluateAll((nodes) =>
        nodes
          .map((node) => node.href || node.src || node.getAttribute("href") || node.getAttribute("src") || "")
          .filter(Boolean)
      );
      urls.push(...found);
    } catch {
      // skip selector failures
    }
  }

  try {
    const genericUrls = await page.evaluate(() => {
      const nodes = [
        ...document.querySelectorAll("a[href], iframe[src], embed[src], object[data]")
      ];
      return nodes
        .map((node) => {
          const raw = node.href || node.src || node.data || node.getAttribute("href") || node.getAttribute("src") || node.getAttribute("data") || "";
          if (!raw) {
            return "";
          }
          try {
            return new URL(raw, document.baseURI).href;
          } catch {
            return raw;
          }
        })
        .filter(Boolean);
    });
    urls.push(...genericUrls);
  } catch {
    // best effort only
  }

  return uniquePreserveOrder(
    urls.filter((url) => {
      const lowered = String(url).toLowerCase();
      return lowered.startsWith("http") && buildPdfHints(lowered);
    })
  ).slice(0, 8);
}

async function attemptContextCandidateFetches({
  context,
  page,
  ref,
  publisher,
  destPath,
  logger,
  requestDelayMs = 0
}) {
  const currentUrl = page.url() || "";
  const candidateUrls = uniquePreserveOrder([
    buildPdfHints(currentUrl) ? currentUrl : "",
    ...(await collectCandidateUrls(page, publisher))
  ].filter(Boolean)).slice(0, 6);

  for (const [index, candidateUrl] of candidateUrls.entries()) {
    if (index > 0 && requestDelayMs) {
      await sleep(requestDelayMs);
    }
    const fetched = await tryContextPdfFetch({
      context,
      ref,
      url: candidateUrl,
      referer: currentUrl,
      destPath,
      logger
    });
    if (fetched) {
      return fetched;
    }
  }

  return null;
}

async function captureFromPopupIfAny(context, knownPages, runner) {
  const newPages = context.pages().filter((page) => !knownPages.has(page) && !page.isClosed());
  const popup = newPages.at(-1);
  if (!popup) {
    return null;
  }
  return runner(popup);
}

async function tryClickSelectors({
  page,
  context,
  ref,
  publisher,
  destPath,
  collector,
  institution,
  auto,
  logger,
  visited,
  depth,
  authenticatedDirectFetch
}) {
  const selectors = uniquePreserveOrder([
    ...getPdfSelectors(publisher),
    ...VIEWER_DOWNLOAD_SELECTORS
  ]).slice(0, 12);

  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (!(await locator.count())) {
        continue;
      }
      const isVisible = await locator.isVisible().catch(() => false);
      if (!isVisible) {
        continue;
      }

      const knownPages = new Set(context.pages());
      await logger.log(ref, "selector_click", "start", page.url(), selector);
      await locator.click({ timeout: 5_000 });
      await page.waitForTimeout(CLICK_WAIT_MS);

      const barrierResult = await resolveBarrier(page, institution, auto);
      if (barrierResult.action === "manual_pending") {
        return {
          state: "manual_pending",
          reason: barrierResult.reason,
          sourceUrl: barrierResult.url || page.url()
        };
      }

      const saved = await collector.waitAndPersist(destPath, ARTIFACT_WAIT_MS);
      if (saved) {
        await logger.log(ref, "selector_click", "downloaded", saved.sourceUrl, selector);
        return saved;
      }

      const popupResult = await captureFromPopupIfAny(context, knownPages, async (popup) => {
        const outcome = await attemptCaptureFromPage({
          context,
          page: popup,
          ref,
          publisher,
          destPath,
          institution,
          auto,
          logger,
          visited,
          depth: depth + 1,
          url: "",
          authenticatedDirectFetch
        });
        await closePageQuietly(popup);
        return outcome;
      });
      if (popupResult) {
        return popupResult;
      }
    } catch {
      // ignore single-selector failures and keep trying
    }
  }
  return null;
}

async function attemptCaptureFromPage({
  context,
  page,
  ref,
  publisher,
  destPath,
  institution,
  auto,
  logger,
  visited,
  depth,
  url,
  authenticatedDirectFetch = { enabled: false, requestDelayMs: 0 }
}) {
  if (depth > MAX_CAPTURE_DEPTH) {
    return { state: "failed_auto", reason: "capture_depth_exceeded", sourceUrl: url || page.url() };
  }

  if (url) {
    if (visited.has(url)) {
      return { state: "failed_auto", reason: "duplicate_candidate_url", sourceUrl: url };
    }
    visited.add(url);
  }

  const collector = attachArtifactCollector(page);
  try {
    if (url) {
      await logger.log(ref, "open", "start", url, `depth=${depth}`);
      await safeGoto(page, url);
      await waitThroughLoadingPage(page, institution);
    }

    const barrierResult = await resolveBarrier(page, institution, auto);
    if (barrierResult.action === "manual_pending") {
      await logger.log(ref, "barrier", "manual_pending", barrierResult.url || page.url(), barrierResult.reason);
      return {
        state: "manual_pending",
        reason: barrierResult.reason,
        sourceUrl: barrierResult.url || page.url()
      };
    }

    const initialSave = await collector.waitAndPersist(destPath, ARTIFACT_WAIT_MS);
    if (initialSave) {
      await logger.log(ref, "capture", "downloaded", initialSave.sourceUrl, `depth=${depth}`);
      return initialSave;
    }

    const currentUrl = page.url() || url || "";
    if (authenticatedDirectFetch?.enabled) {
      const fetchedFromContext = await attemptContextCandidateFetches({
        context,
        page,
        ref,
        publisher,
        destPath,
        logger,
        requestDelayMs: authenticatedDirectFetch.requestDelayMs || 0
      });
      if (fetchedFromContext) {
        return fetchedFromContext;
      }
    }

    if (buildPdfHints(currentUrl)) {
      const afterViewerClick = await tryClickSelectors({
        page,
        context,
        ref,
        publisher,
        destPath,
        collector,
        institution,
        auto,
        logger,
        visited,
        depth,
        authenticatedDirectFetch
      });
      if (afterViewerClick) {
        return afterViewerClick;
      }
    }

    for (const candidateUrl of await collectCandidateUrls(page, publisher)) {
      const childPage = await context.newPage();
      try {
        const childResult = await attemptCaptureFromPage({
          context,
          page: childPage,
          ref,
          publisher,
          destPath,
          institution,
          auto,
          logger,
          visited,
          depth: depth + 1,
          url: candidateUrl,
          authenticatedDirectFetch
        });
        if (childResult.state !== "failed_auto") {
          return childResult;
        }
      } finally {
        await closePageQuietly(childPage);
      }
    }

    const clickResult = await tryClickSelectors({
      page,
      context,
      ref,
      publisher,
      destPath,
      collector,
      institution,
      auto,
      logger,
      visited,
      depth,
      authenticatedDirectFetch
    });
    if (clickResult) {
      return clickResult;
    }

    return {
      state: "failed_auto",
      reason: "no_pdf_path_found",
      sourceUrl: currentUrl
    };
  } finally {
    collector.dispose();
  }
}

function chooseDownloadFormat(metadata = {}) {
  const probe = [
    metadata.downloadLabels || "",
    metadata.text || "",
    metadata.title || ""
  ].join(" ").toLowerCase();

  if (probe.includes("pdf")) {
    return "pdf";
  }
  if (probe.includes("caj")) {
    return "caj";
  }
  return "unknown";
}

function buildPreferredChinesePlatforms(ref) {
  const explicit = Array.isArray(ref.preferred_platforms) ? ref.preferred_platforms : [];
  const inferred = inferSourcePlatform(ref);
  return uniquePreserveOrder([inferred, ...explicit, ...CHINESE_PLATFORM_ORDER].filter(Boolean));
}

async function extractPageMetadata(page) {
  return page.evaluate(() => {
    const queryMeta = (selector) => (
      Array.from(document.querySelectorAll(selector))
        .map((node) => node.getAttribute("content") || "")
        .map((item) => item.trim())
        .filter(Boolean)
    );
    const toAbsoluteUrl = (value) => {
      if (!value) {
        return "";
      }
      try {
        return new URL(value, document.baseURI).href;
      } catch {
        return value;
      }
    };

    const titleCandidates = [
      ...queryMeta('meta[name="citation_title"]'),
      ...queryMeta('meta[property="og:title"]'),
      ...queryMeta('meta[name="dc.title"]'),
      ...(document.querySelector("h1")?.innerText ? [document.querySelector("h1").innerText] : []),
      document.title || ""
    ].map((item) => item.trim()).filter(Boolean);

    const authors = [
      ...queryMeta('meta[name="citation_author"]'),
      ...queryMeta('meta[name="dc.creator"]'),
      ...queryMeta('meta[name="author"]')
    ];

    const doi = [
      ...queryMeta('meta[name="citation_doi"]'),
      ...queryMeta('meta[name="dc.identifier.doi"]'),
      ...queryMeta('meta[name="prism.doi"]')
    ][0] || "";

    const journal = [
      ...queryMeta('meta[name="citation_journal_title"]'),
      ...queryMeta('meta[name="prism.publicationName"]')
    ][0] || "";

    const year = [
      ...queryMeta('meta[name="citation_publication_date"]'),
      ...queryMeta('meta[name="citation_date"]'),
      ...queryMeta('meta[name="dc.date"]')
    ][0] || "";

    const text = (document.body?.innerText || "").slice(0, 8000);
    const links = Array.from(document.querySelectorAll("a[href], button"))
      .map((node) => ({
        href: "href" in node ? toAbsoluteUrl(node.getAttribute("href") || node.href || "") : "",
        label: (node.innerText || node.textContent || node.getAttribute("title") || "").trim()
      }))
      .filter((item) => item.href || item.label)
      .slice(0, 300);

    return {
      title: titleCandidates.find((item) => item.length >= 4) || "",
      authors,
      doi,
      journal,
      year,
      text,
      links,
      downloadLabels: links.map((item) => item.label).filter(Boolean).join(" | ")
    };
  });
}

async function submitSearchQuery(page, query, config) {
  for (const selector of config.searchInputSelectors) {
    try {
      const locator = page.locator(selector).first();
      if (!(await locator.count())) {
        continue;
      }
      const visible = await locator.isVisible().catch(() => false);
      const editable = await locator.isEditable().catch(() => false);
      if (!visible || !editable) {
        continue;
      }
      await locator.click({ timeout: 3_000 });
      await locator.fill("");
      await locator.fill(query);

      for (const buttonSelector of config.searchButtonSelectors) {
        const button = page.locator(buttonSelector).first();
        if ((await button.count()) && await button.isVisible().catch(() => false)) {
          await button.click({ timeout: 5_000 });
          await page.waitForTimeout(CLICK_WAIT_MS);
          return true;
        }
      }

      await locator.press("Enter");
      await page.waitForTimeout(CLICK_WAIT_MS);
      return true;
    } catch {
      // keep trying alternate selectors
    }
  }
  return false;
}

async function collectSearchResultCandidates(page, platform, ref) {
  const config = CHINESE_PLATFORM_CONFIGS[platform];
  const items = await page.evaluate(({ articleUrlTokens, hostTokens }) => {
    const toAbsoluteUrl = (value) => {
      if (!value) {
        return "";
      }
      try {
        return new URL(value, document.baseURI).href;
      } catch {
        return value;
      }
    };

    return Array.from(document.querySelectorAll("a[href]"))
      .map((node) => {
        const href = toAbsoluteUrl(node.getAttribute("href") || node.href || "");
        const text = (node.innerText || node.textContent || "").trim();
        const title = (node.getAttribute("title") || "").trim();
        const container = node.closest("article,li,div,tr,section");
        return {
          href,
          title: title || text,
          text: text || title,
          containerText: (container?.innerText || "").slice(0, 800)
        };
      })
      .filter((item) => (
        item.href &&
        hostTokens.some((token) => item.href.toLowerCase().includes(token)) &&
        articleUrlTokens.some((token) => item.href.toLowerCase().includes(token))
      ));
  }, { articleUrlTokens: config.articleUrlTokens, hostTokens: config.hostTokens });

  const deduped = uniquePreserveOrder(items.map((item) => item.href))
    .map((href) => items.find((item) => item.href === href))
    .filter(Boolean);

  return deduped
    .map((item) => ({
      ...item,
      platform,
      year: extractYearFromText(item.containerText || ""),
      titleScore: computeTitleSimilarity(ref.title || ref.source_text || "", item.title || item.text || item.containerText || "")
    }))
    .filter((item) => item.titleScore >= 0.72)
    .sort((left, right) => right.titleScore - left.titleScore)
    .slice(0, 6);
}

async function resolveChineseArticleCandidate({
  context,
  ref,
  platform,
  candidate,
  institution,
  auto,
  logger,
  destPath,
  authenticatedDirectFetch
}) {
  const page = await context.newPage();
  try {
    const publisher = platform === "cqvip" ? "unknown" : platform;
    await logger.log(ref, "candidate_open", "start", candidate.href, platform);
    await safeGoto(page, candidate.href);
    await waitThroughLoadingPage(page, institution);

    const barrierResult = await resolveBarrier(page, institution, auto);
    if (barrierResult.action === "manual_pending") {
      return {
        state: "manual_pending",
        reason: barrierResult.reason,
        sourceUrl: barrierResult.url || page.url(),
        sourcePlatform: platform,
        articleUrl: candidate.href
      };
    }

    const metadata = await extractPageMetadata(page).catch(() => ({
      title: "",
      authors: [],
      doi: "",
      journal: "",
      year: "",
      text: "",
      links: [],
      downloadLabels: ""
    }));

    const match = assessReferenceCandidate(ref, {
      title: metadata.title || candidate.title || candidate.text || "",
      authors: metadata.authors,
      doi: metadata.doi,
      year: extractYearFromText(metadata.year || "") || extractYearFromText(metadata.text || "") || candidate.year || 0,
      text: [candidate.containerText || "", metadata.text || ""].join(" "),
      download_ready: chooseDownloadFormat(metadata) !== "unknown"
    });

    if (!match.accepted) {
      await logger.log(ref, "platform_match", "rejected", candidate.href, `${platform}:${match.reason}:${match.confidence}`);
      return {
        state: "failed_auto",
        reason: match.reason,
        sourceUrl: candidate.href,
        sourcePlatform: platform,
        matchConfidence: match.confidence,
        downloadFormat: chooseDownloadFormat(metadata),
      articleUrl: candidate.href
      };
    }

    const result = await attemptCaptureFromPage({
      context,
      page,
      ref,
      publisher,
      destPath,
      institution,
      auto,
      logger,
      visited: new Set([candidate.href]),
      depth: 0,
      url: "",
      authenticatedDirectFetch
    });

    if (result.state === "downloaded") {
      return {
        ...result,
        sourcePlatform: platform,
        matchConfidence: match.confidence,
        downloadFormat: "pdf",
        articleUrl: candidate.href
      };
    }

    const format = chooseDownloadFormat(metadata);
    if (format === "caj") {
      return {
        state: "failed_auto",
        reason: "caj_only_not_supported",
        sourceUrl: candidate.href,
        sourcePlatform: platform,
        matchConfidence: match.confidence,
        downloadFormat: "caj",
        articleUrl: candidate.href
      };
    }

    return {
      ...result,
      sourcePlatform: platform,
      matchConfidence: match.confidence,
      downloadFormat: format,
      articleUrl: candidate.href
    };
  } finally {
    await closePageQuietly(page);
  }
}

async function attemptChinesePlatformDownload({
  context,
  ref,
  destPath,
  institution,
  auto,
  logger,
  authenticatedDirectFetch
}) {
  const platforms = buildPreferredChinesePlatforms(ref);
  let fallbackResult = {
    state: "failed_auto",
    reason: "strict_match_not_met",
    sourceUrl: ref.article_url || ref.link || "",
    sourcePlatform: "",
    matchConfidence: "",
    downloadFormat: "",
    articleUrl: ref.article_url || ref.link || ""
  };

  for (const platform of platforms) {
    const config = CHINESE_PLATFORM_CONFIGS[platform];
    if (!config) {
      continue;
    }

    const directUrl = [ref.article_url, ref.link, ...(ref.links || [])]
      .find((item) => inferSourcePlatform({ link: item }) === platform);
    if (directUrl) {
      const directCandidate = {
        href: directUrl,
        title: "",
        text: "",
        containerText: ""
      };
      const directResult = await resolveChineseArticleCandidate({
        context,
        ref,
        platform,
        candidate: directCandidate,
        institution,
        auto,
        logger,
        destPath,
        authenticatedDirectFetch
      });
      if (directResult.state === "downloaded" || directResult.state === "manual_pending") {
        return directResult;
      }
      fallbackResult = directResult;
    }

    const page = await context.newPage();
    try {
      await logger.log(ref, "platform_search", "start", config.homeUrl, platform);
      await safeGoto(page, config.homeUrl);
      await waitThroughLoadingPage(page, institution);

      const barrier = await resolveBarrier(page, institution, auto);
      if (barrier.action === "manual_pending") {
        return {
          state: "manual_pending",
          reason: barrier.reason,
          sourceUrl: barrier.url || page.url(),
          sourcePlatform: platform,
          articleUrl: ""
        };
      }

      const query = buildChineseSearchQuery(ref);
      if (!query) {
        fallbackResult = {
          state: "failed_auto",
          reason: "missing_search_query",
          sourceUrl: page.url(),
          sourcePlatform: platform,
          matchConfidence: "",
          downloadFormat: "",
          articleUrl: ""
        };
        continue;
      }

      const submitted = await submitSearchQuery(page, query, config);
      if (!submitted) {
        fallbackResult = {
          state: "failed_auto",
          reason: "platform_search_box_not_found",
          sourceUrl: page.url(),
          sourcePlatform: platform,
          matchConfidence: "",
          downloadFormat: "",
          articleUrl: ""
        };
        continue;
      }

      await waitThroughLoadingPage(page, institution);
      const barrierAfterSearch = await resolveBarrier(page, institution, auto);
      if (barrierAfterSearch.action === "manual_pending") {
        return {
          state: "manual_pending",
          reason: barrierAfterSearch.reason,
          sourceUrl: barrierAfterSearch.url || page.url(),
          sourcePlatform: platform,
          articleUrl: ""
        };
      }

      const candidates = await collectSearchResultCandidates(page, platform, ref);
      if (candidates.length === 0) {
        fallbackResult = {
          state: "failed_auto",
          reason: "platform_search_no_candidate",
          sourceUrl: page.url(),
          sourcePlatform: platform,
          matchConfidence: "",
          downloadFormat: "",
          articleUrl: ""
        };
        continue;
      }

      for (const candidate of candidates) {
        const candidateResult = await resolveChineseArticleCandidate({
          context,
          ref,
          platform,
          candidate,
          institution,
          auto,
          logger,
          destPath,
          authenticatedDirectFetch
        });
        if (candidateResult.state === "downloaded" || candidateResult.state === "manual_pending") {
          return candidateResult;
        }

        if (
          fallbackResult.reason === "strict_match_not_met" ||
          fallbackResult.reason === "platform_search_no_candidate" ||
          fallbackResult.reason === "all_attempts_failed"
        ) {
          fallbackResult = candidateResult;
        }
      }
    } finally {
      await closePageQuietly(page);
    }
  }

  return fallbackResult;
}

function summarizeDownloadRows(rows = []) {
  const byStatus = {};
  const failed = [];
  const downloaded = [];

  for (const row of rows) {
    const status = row.pdf_status || "unknown";
    byStatus[status] = (byStatus[status] || 0) + 1;

    if (status === "downloaded" || status === "already_exists") {
      downloaded.push({
        id: row.id,
        title: row.title,
        doi: row.doi,
        file: row.pdf_file,
        status,
        oa_source: row.oa_source || "",
        source_platform: row.source_platform || ""
      });
      continue;
    }

    failed.push({
      id: row.id,
      title: row.title,
      doi: row.doi,
      status,
      reason: row.notes || "",
      source_platform: row.source_platform || "",
      article_url: row.article_url || row.source_url || ""
    });
  }

  return {
    total: rows.length,
    by_status: byStatus,
    downloaded,
    failed
  };
}

function needsHumanIntervention(row) {
  const status = row.pdf_status || "";
  if (!HUMAN_REVIEW_STATUSES.has(status)) {
    return false;
  }
  if (LOW_VALUE_REVIEW_REASONS.has(row.notes || "")) {
    return false;
  }
  return true;
}

function interventionKind(row) {
  if (row.pdf_status === "manual_pending") {
    return "blocked";
  }
  if (row.pdf_status === "no_doi") {
    return "metadata";
  }
  if (row.pdf_status === "failed_exception") {
    return "error";
  }
  return "review";
}

function suggestedHumanAction(row) {
  const reason = row.notes || "";
  if (row.pdf_status === "manual_pending") {
    if (reason.includes("institution_auth_redirect")) {
      return "Finish institutional login in the browser, then rerun the downloader interactively or normally.";
    }
    if (reason.includes("captcha") || reason.includes("challenge")) {
      return "Complete the visible human verification in the browser, then rerun the downloader.";
    }
    return "Inspect the opened page, resolve the blocking prompt, then rerun the downloader.";
  }
  if (row.pdf_status === "no_doi") {
    return "Provide or fix DOI/article URL metadata, then rerun validation and download.";
  }
  if (reason === "caj_only_not_supported") {
    return "Decide whether this item can be accepted as CAJ or locate a PDF version manually.";
  }
  if (reason === "strict_match_not_met") {
    return "Open the candidate page and confirm title/author/year before any manual download.";
  }
  return "Inspect the source URL or DOI page manually; if the site is accessible, rerun after the browser session is ready.";
}

export function buildManualInterventionQueue(rows = []) {
  return rows
    .filter(needsHumanIntervention)
    .map((row) => ({
      id: row.id,
      kind: interventionKind(row),
      status: row.pdf_status || "",
      reason: row.notes || "",
      title: row.title || "",
      doi: row.doi || "",
      publisher: row.publisher || "",
      source_platform: row.source_platform || "",
      article_url: row.article_url || "",
      source_url: row.source_url || "",
      target_pdf_file: row.target_pdf_file || row.pdf_file || "",
      suggested_action: suggestedHumanAction(row)
    }));
}

function markdownLink(url = "") {
  if (!url) {
    return "";
  }
  return `[open](${url})`;
}

export function renderManualInterventionMarkdown(queue = [], generatedAt = nowIso()) {
  const lines = [
    "# Manual Intervention Queue",
    "",
    `Generated: ${generatedAt}`,
    "",
    "This file lists references where automation could not safely finish. Complete institutional login or visible verification in the real browser; do not bypass CAPTCHA, Cloudflare, or publisher access controls.",
    ""
  ];

  if (queue.length === 0) {
    lines.push("No human intervention is needed for the latest run.");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  lines.push("| ID | Kind | Status | Reason | Title | Link | Suggested Action |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const item of queue) {
    const link = markdownLink(item.source_url || item.article_url || (item.doi ? `https://doi.org/${item.doi}` : ""));
    const title = String(item.title || item.doi || `Ref ${item.id}`).replaceAll("|", "\\|").slice(0, 120);
    const action = String(item.suggested_action || "").replaceAll("|", "\\|");
    const reason = String(item.reason || "").replaceAll("|", "\\|");
    lines.push(`| ${item.id} | ${item.kind} | ${item.status} | ${reason} | ${title} | ${link} | ${action} |`);
  }
  lines.push("");
  lines.push("After human handling, rerun the same downloader command. Existing PDFs are skipped automatically, so the rerun concentrates on unresolved items.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function printProgress(index, total, ref) {
  const label = ref.label || `Ref${ref.id}`;
  process.stdout.write(`[${String(index).padStart(2, " ")} / ${total}] ${label} (${ref.publisher || "unknown"})\n`);
}

async function attemptOpenAccessDownload({ ref, destPath, config, logger }) {
  const resolved = await resolveOpenAccessCandidates(ref, config);
  const details = [
    `candidates=${resolved.candidates.length}`,
    resolved.warnings.length ? `warnings=${resolved.warnings.join(";")}` : "",
    resolved.errors.length ? `errors=${resolved.errors.join(";")}` : ""
  ].filter(Boolean).join(" ");

  await logger.log(ref, "oa_resolve", resolved.candidates.length ? "found" : "empty", "", details);
  if (resolved.candidates.length === 0) {
    return {
      state: "failed_auto",
      reason: resolved.errors.length ? `oa_resolve_failed:${resolved.errors.join(";")}` : "oa_no_candidate",
      sourceUrl: "",
      sourcePlatform: "",
      articleUrl: ref.article_url || ref.link || "",
      matchConfidence: "",
      downloadFormat: "",
      oaSource: ""
    };
  }

  for (const [index, candidate] of resolved.candidates.entries()) {
    if (index > 0 && config.openAccess?.requestDelayMs) {
      await sleep(config.openAccess.requestDelayMs);
    }
    await logger.log(ref, "oa_candidate", "start", candidate.url, candidate.source);
    const fetched = await tryDirectPdfFetch({
      ref,
      url: candidate.url,
      destPath,
      logger
    });
    if (fetched) {
      return {
        ...fetched,
        sourcePlatform: "",
        articleUrl: candidate.landingUrl || ref.article_url || ref.link || candidate.url,
        matchConfidence: "",
        downloadFormat: "pdf",
        oaSource: candidate.source
      };
    }
  }

  return {
    state: "failed_auto",
    reason: "oa_candidates_not_pdf",
    sourceUrl: resolved.candidates.at(-1)?.url || "",
    sourcePlatform: "",
    articleUrl: ref.article_url || ref.link || "",
    matchConfidence: "",
    downloadFormat: "",
    oaSource: resolved.candidates.map((candidate) => candidate.source).join("|")
  };
}

export async function downloadValidatedReferences({ projectDir, validatedData, config, auto = false }) {
  const rows = [];
  const runsRoot = path.join(path.dirname(projectDir), "runs");
  const logger = await createRunLogger(runsRoot);
  const downloadTempDir = path.join(logger.runDir, "downloads");
  await ensureDir(downloadTempDir);
  const authenticatedDirectFetch = {
    enabled: Boolean(config.download?.authenticatedDirectFetch),
    requestDelayMs: config.download?.directRequestDelayMs || 0
  };

  let context = null;
  let browserLaunchPromise = null;
  const ensureBrowserContext = async () => {
    if (context) {
      return context;
    }
    if (!browserLaunchPromise) {
      browserLaunchPromise = (async () => {
        let playwrightModule;
        try {
          playwrightModule = await import("playwright");
        } catch (error) {
          throw new Error(`Playwright is not installed. Run "npm install" inside ${projectDir}: ${error.message}`);
        }

        const { chromium } = playwrightModule;
        const runtime = resolveBrowserRuntime(config.browser);
        const launchOptions = {
          acceptDownloads: true,
          args: [
            ...runtime.launchArgs,
            "--no-first-run",
            "--no-default-browser-check"
          ],
          channel: runtime.channel,
          downloadsPath: downloadTempDir,
          headless: runtime.headless,
          slowMo: runtime.slowMoMs,
          viewport: { width: 1440, height: 960 }
        };
        if (runtime.executablePath) {
          launchOptions.executablePath = runtime.executablePath;
        }

        try {
          return await chromium.launchPersistentContext(runtime.userDataDir, launchOptions);
        } catch (error) {
          throw new Error(
            `Failed to launch ${runtime.channel} with user data dir ${runtime.userDataDir}. Close all browser windows first. ${error.message}`
          );
        }
      })();
    }
    context = await browserLaunchPromise;
    return context;
  };

  try {
    const total = validatedData.references.length;
    const usedFileNames = new Set();
    for (const [offset, ref] of validatedData.references.entries()) {
      printProgress(offset + 1, total, ref);
      let plannedFileName = "";
      try {
        const fileChoice = await chooseOutputFilename(projectDir, ref, usedFileNames);
        const fileName = fileChoice.fileName;
        plannedFileName = fileName;
        const destPath = path.join(projectDir, fileName);
        const isChineseRoute = ref.route_family === "chinese_platform";

        if (!isChineseRoute && ref.status === "no_doi") {
          rows.push(buildReportRow(ref, { target_pdf_file: fileName, pdf_status: "no_doi", notes: ref.error || "" }));
          continue;
        }
        if (ref.status === "ignored") {
          rows.push(buildReportRow(ref, { target_pdf_file: fileName, pdf_status: "ignored", notes: ref.error || "" }));
          continue;
        }
        if (fileChoice.alreadyExists) {
          const existingStats = await fs.stat(destPath);
          rows.push(buildReportRow(ref, {
            pdf_file: fileName,
            target_pdf_file: fileName,
            pdf_status: "already_exists",
            pdf_size_kb: kbFromBytes(existingStats.size),
            notes: "Skipped because the PDF already exists"
          }));
          continue;
        }

        let finalResult = {
          state: "failed_auto",
          reason: "all_attempts_failed",
          sourceUrl: "",
          sourcePlatform: ref.source_platform || "",
          articleUrl: ref.article_url || ref.link || "",
          matchConfidence: "",
          downloadFormat: "",
          oaSource: ""
        };

        if (isChineseRoute) {
          if (!config.download?.browserFallback) {
            finalResult = {
              ...finalResult,
              reason: "browser_fallback_disabled_for_chinese_platform"
            };
          } else {
            finalResult = await attemptChinesePlatformDownload({
              context: await ensureBrowserContext(),
              ref,
              destPath,
              institution: config.institution,
              auto,
              logger,
              authenticatedDirectFetch
            });
          }
        } else {
          if (config.openAccess?.enabled) {
            finalResult = await attemptOpenAccessDownload({
              ref,
              destPath,
              config,
              logger
            });
          }

          const attemptUrls = uniquePreserveOrder([
            buildDirectPdfUrl(ref.doi, ref.publisher),
            buildArticleUrl(ref.doi, ref.publisher),
            ref.article_url || ref.link || "",
            ...derivePdfUrlsFromArticleUrl(ref.article_url || ref.link || "", ref, ref.publisher || "unknown")
          ]).filter(Boolean);

          if (attemptUrls.length === 0 && finalResult.state !== "downloaded") {
            finalResult = {
              state: "failed_auto",
              reason: "no_download_route_available",
              sourceUrl: "",
              sourcePlatform: "",
              articleUrl: ref.article_url || ref.link || "",
              matchConfidence: "",
              downloadFormat: "",
              oaSource: finalResult.oaSource || ""
            };
          }

          if (finalResult.state !== "downloaded" && config.download?.publisherDirectFetch) {
            for (const [index, candidateUrl] of attemptUrls.entries()) {
              if (index > 0 && config.download?.directRequestDelayMs) {
                await sleep(config.download.directRequestDelayMs);
              }
              const fetched = await tryDirectPdfFetch({
                ref,
                url: candidateUrl,
                destPath,
                logger
              });
              if (fetched) {
                finalResult = {
                  ...fetched,
                  sourcePlatform: ref.source_platform || "",
                  articleUrl: ref.article_url || ref.link || candidateUrl,
                  matchConfidence: "",
                  downloadFormat: "pdf",
                  oaSource: finalResult.oaSource || ""
                };
                break;
              }
            }
          }

          if (finalResult.state !== "downloaded" && config.download?.browserFallback) {
            const browserContext = await ensureBrowserContext();
            for (const [index, attemptUrl] of attemptUrls.entries()) {
              if (index > 0 && config.download?.browserAttemptDelayMs) {
                await sleep(config.download.browserAttemptDelayMs);
              }
              const page = await browserContext.newPage();
              try {
                const result = await attemptCaptureFromPage({
                  context: browserContext,
                  page,
                  ref,
                  publisher: ref.publisher || "unknown",
                  destPath,
                  institution: config.institution,
                  auto,
                  logger,
                  visited: new Set(),
                  depth: 0,
                  url: attemptUrl,
                  authenticatedDirectFetch
                });
                finalResult = {
                  ...result,
                  sourcePlatform: ref.source_platform || "",
                  articleUrl: ref.article_url || ref.link || attemptUrl,
                  matchConfidence: "",
                  downloadFormat: result.state === "downloaded" ? "pdf" : "",
                  oaSource: finalResult.oaSource || ""
                };
                if (result.state !== "failed_auto") {
                  break;
                }
              } finally {
                await closePageQuietly(page);
              }
            }
          }
        }

        if (finalResult.state === "downloaded") {
          rows.push(buildReportRow(ref, {
            pdf_file: fileName,
            target_pdf_file: fileName,
            pdf_status: "downloaded",
            download_format: finalResult.downloadFormat || "pdf",
            pdf_size_kb: finalResult.sizeKb || "",
            oa_source: finalResult.oaSource || "",
            source_platform: finalResult.sourcePlatform || ref.source_platform || "",
            article_url: finalResult.articleUrl || ref.article_url || ref.link || "",
            source_url: finalResult.sourceUrl || "",
            match_confidence: finalResult.matchConfidence || "",
            notes: ""
          }));
        } else if (finalResult.state === "manual_pending") {
          rows.push(buildReportRow(ref, {
            target_pdf_file: fileName,
            pdf_status: "manual_pending",
            download_format: finalResult.downloadFormat || "",
            oa_source: finalResult.oaSource || "",
            source_platform: finalResult.sourcePlatform || ref.source_platform || "",
            article_url: finalResult.articleUrl || ref.article_url || ref.link || "",
            source_url: finalResult.sourceUrl || "",
            match_confidence: finalResult.matchConfidence || "",
            notes: finalResult.reason || ""
          }));
        } else {
          rows.push(buildReportRow(ref, {
            target_pdf_file: fileName,
            pdf_status: "failed_auto",
            download_format: finalResult.downloadFormat || "",
            oa_source: finalResult.oaSource || "",
            source_platform: finalResult.sourcePlatform || ref.source_platform || "",
            article_url: finalResult.articleUrl || ref.article_url || ref.link || "",
            source_url: finalResult.sourceUrl || "",
            match_confidence: finalResult.matchConfidence || "",
            notes: finalResult.reason || ""
          }));
        }
      } catch (error) {
        rows.push(buildReportRow(ref, {
          target_pdf_file: plannedFileName,
          pdf_status: "failed_exception",
          notes: String(error?.message || error)
        }));
      } finally {
        await writeCsv(path.join(projectDir, "download_report.csv"), rows);
        await sleep(config.download?.itemDelayMs ?? 750);
      }
    }
  } finally {
    if (context) {
      await context.close();
    }
  }

  const summary = summarizeDownloadRows(rows);
  const manualQueue = config.download?.manualInterventionQueue
    ? buildManualInterventionQueue(rows)
    : [];
  const manualQueuePath = path.join(projectDir, "manual_intervention_queue.json");
  const manualMarkdownPath = path.join(projectDir, "manual_intervention.md");
  if (config.download?.manualInterventionQueue) {
    const generatedAt = nowIso();
    await writeJson(manualQueuePath, {
      generated_at: generatedAt,
      total: manualQueue.length,
      items: manualQueue
    });
    await fs.writeFile(manualMarkdownPath, renderManualInterventionMarkdown(manualQueue, generatedAt), "utf8");
    summary.manual_intervention = {
      total: manualQueue.length,
      queue_path: manualQueuePath,
      markdown_path: manualMarkdownPath
    };
  }
  const summaryPath = path.join(projectDir, "download_summary.json");
  await writeJson(summaryPath, summary);

  return {
    rows,
    runDir: logger.runDir,
    summary,
    summaryPath,
    manualQueue,
    manualQueuePath: config.download?.manualInterventionQueue ? manualQueuePath : "",
    manualMarkdownPath: config.download?.manualInterventionQueue ? manualMarkdownPath : ""
  };
}
