import fs from "node:fs/promises";
import path from "node:path";

import { SKILL_ROOT } from "./paths.mjs";

const DEFAULT_CONFIG = {
  crossref: {
    mailto: "your.email@example.com"
  },
  browser: {
    channel: "chrome",
    userDataDir: "",
    profileDirectory: "Default",
    executablePath: "",
    disableExtensions: false,
    headless: false,
    slowMoMs: 0
  },
  institution: {
    authHosts: [],
    authUrlFragments: [],
    authPageTitles: [],
    authLoadingTitles: [],
    ignoredAccessDois: []
  }
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
  const output = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (Array.isArray(value)) {
      output[key] = [...value];
      continue;
    }
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMerge(output[key], value);
      continue;
    }
    output[key] = value;
  }
  return output;
}

function parseBoolean(value, defaultValue = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value !== "string") {
    return defaultValue;
  }
  const lowered = value.trim().toLowerCase();
  if (!lowered) {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(lowered);
}

function parseList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

async function readIfExists(filePath) {
  try {
    return await readJsonFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function applyEnvOverrides(config, env = process.env) {
  const output = deepMerge(DEFAULT_CONFIG, config);

  if (env.PAPER_DOWNLOADER_MAILTO) {
    output.crossref.mailto = env.PAPER_DOWNLOADER_MAILTO;
  }
  if (env.PAPER_DOWNLOADER_BROWSER_CHANNEL) {
    output.browser.channel = env.PAPER_DOWNLOADER_BROWSER_CHANNEL;
  }
  if (env.PAPER_DOWNLOADER_BROWSER_USER_DATA_DIR) {
    output.browser.userDataDir = env.PAPER_DOWNLOADER_BROWSER_USER_DATA_DIR;
  }
  if (env.PAPER_DOWNLOADER_BROWSER_PROFILE) {
    output.browser.profileDirectory = env.PAPER_DOWNLOADER_BROWSER_PROFILE;
  }
  if (env.PAPER_DOWNLOADER_BROWSER_EXECUTABLE) {
    output.browser.executablePath = env.PAPER_DOWNLOADER_BROWSER_EXECUTABLE;
  }
  if (env.PAPER_DOWNLOADER_DISABLE_EXTENSIONS) {
    output.browser.disableExtensions = parseBoolean(env.PAPER_DOWNLOADER_DISABLE_EXTENSIONS);
  }
  if (env.PAPER_DOWNLOADER_HEADLESS) {
    output.browser.headless = parseBoolean(env.PAPER_DOWNLOADER_HEADLESS);
  }
  if (env.PAPER_DOWNLOADER_AUTH_HOSTS) {
    output.institution.authHosts = parseList(env.PAPER_DOWNLOADER_AUTH_HOSTS);
  }
  if (env.PAPER_DOWNLOADER_AUTH_URL_FRAGMENTS) {
    output.institution.authUrlFragments = parseList(env.PAPER_DOWNLOADER_AUTH_URL_FRAGMENTS);
  }
  if (env.PAPER_DOWNLOADER_AUTH_PAGE_TITLES) {
    output.institution.authPageTitles = parseList(env.PAPER_DOWNLOADER_AUTH_PAGE_TITLES);
  }
  if (env.PAPER_DOWNLOADER_AUTH_LOADING_TITLES) {
    output.institution.authLoadingTitles = parseList(env.PAPER_DOWNLOADER_AUTH_LOADING_TITLES);
  }
  if (env.PAPER_DOWNLOADER_IGNORED_DOIS) {
    output.institution.ignoredAccessDois = parseList(env.PAPER_DOWNLOADER_IGNORED_DOIS);
  }

  return output;
}

function normalizeConfig(config) {
  const merged = deepMerge(DEFAULT_CONFIG, config);
  return {
    crossref: {
      mailto: String(merged.crossref?.mailto || DEFAULT_CONFIG.crossref.mailto).trim()
    },
    browser: {
      channel: String(merged.browser?.channel || DEFAULT_CONFIG.browser.channel).trim() || "chrome",
      userDataDir: String(merged.browser?.userDataDir || "").trim(),
      profileDirectory: String(merged.browser?.profileDirectory || "Default").trim() || "Default",
      executablePath: String(merged.browser?.executablePath || "").trim(),
      disableExtensions: parseBoolean(merged.browser?.disableExtensions),
      headless: parseBoolean(merged.browser?.headless),
      slowMoMs: Number(merged.browser?.slowMoMs || 0)
    },
    institution: {
      authHosts: parseList(merged.institution?.authHosts),
      authUrlFragments: parseList(merged.institution?.authUrlFragments),
      authPageTitles: parseList(merged.institution?.authPageTitles),
      authLoadingTitles: parseList(merged.institution?.authLoadingTitles),
      ignoredAccessDois: parseList(merged.institution?.ignoredAccessDois)
    }
  };
}

export async function loadConfig({ cliConfigPath = "", skillRoot = SKILL_ROOT, env = process.env } = {}) {
  const examplePath = path.join(skillRoot, "config.example.json");
  const localPath = path.join(skillRoot, "config.local.json");
  const extraPath = cliConfigPath || env.PAPER_DOWNLOADER_CONFIG || "";

  let merged = deepMerge({}, DEFAULT_CONFIG);
  const layers = [
    await readIfExists(examplePath),
    await readIfExists(localPath),
    extraPath ? await readIfExists(path.resolve(extraPath)) : null
  ];

  for (const layer of layers) {
    if (layer) {
      merged = deepMerge(merged, layer);
    }
  }

  merged = applyEnvOverrides(merged, env);

  return {
    config: normalizeConfig(merged),
    paths: {
      skillRoot,
      examplePath,
      localPath,
      extraPath: extraPath ? path.resolve(extraPath) : ""
    }
  };
}

export function applyCliOverrides(config, options = {}) {
  const merged = deepMerge({}, config);
  if (options.browser) {
    merged.browser.channel = String(options.browser);
  }
  if (options.profile) {
    merged.browser.profileDirectory = String(options.profile);
  }
  if (options.userDataDir) {
    merged.browser.userDataDir = String(options.userDataDir);
  }
  if (options.executablePath) {
    merged.browser.executablePath = String(options.executablePath);
  }
  if (options.headless) {
    merged.browser.headless = true;
  }
  return normalizeConfig(merged);
}

export function warnIfPlaceholderMailto(config) {
  if ((config.crossref?.mailto || "").toLowerCase() === "your.email@example.com") {
    process.stderr.write("WARNING: crossref.mailto is still the placeholder value in config.local.json\n");
  }
}
