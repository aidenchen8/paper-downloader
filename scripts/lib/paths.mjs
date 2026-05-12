import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const WINDOWS_RESERVED_FILENAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9"
]);

export function normalizeBrowserChannel(channel = "chrome") {
  const lowered = String(channel).trim().toLowerCase();
  if (!lowered || lowered === "chrome" || lowered === "google-chrome") {
    return "chrome";
  }
  if (lowered === "edge" || lowered === "msedge" || lowered === "microsoft-edge") {
    return "msedge";
  }
  return lowered;
}

export function sanitizeProjectName(doi) {
  const lastSegment = String(doi).split("/").pop() || String(doi);
  return lastSegment.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export function sanitizeFilename(stem) {
  const cleaned = String(stem)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/_+/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();

  const collapsed = cleaned
    .replace(/\s*_\s*/g, "_")
    .replace(/\s{2,}/g, " ")
    .replace(/^_+|_+$/g, "");

  if (!collapsed) {
    return "";
  }

  if (WINDOWS_RESERVED_FILENAMES.has(collapsed.toLowerCase())) {
    return `${collapsed}_file`;
  }

  return collapsed;
}

export function truncateFilenameStem(stem, maxLength = 180) {
  const sanitized = sanitizeFilename(stem);
  if (sanitized.length <= maxLength) {
    return sanitized;
  }

  return sanitized
    .slice(0, maxLength)
    .replace(/[. _-]+$/g, "")
    .trim();
}

export function buildProjectPaths(outputDir, projectName) {
  const projectDir = path.resolve(outputDir, projectName);
  return {
    outputDir: path.resolve(outputDir),
    projectDir,
    rawRefsPath: path.join(projectDir, "refs_raw.json"),
    validatedRefsPath: path.join(projectDir, "refs_validated.json"),
    reportPath: path.join(projectDir, "download_report.csv"),
    metaPath: path.join(projectDir, "project_meta.json"),
    runsRoot: path.join(outputDir, "runs")
  };
}

export function resolveOutputDir({ inputKind, inputPath, projectName, explicitOutputDir, cwd = process.cwd() }) {
  if (explicitOutputDir) {
    return path.resolve(explicitOutputDir);
  }
  if (inputKind !== "doi" && inputPath) {
    const directory = path.dirname(inputPath);
    const stem = path.basename(inputPath, path.extname(inputPath));
    return path.join(directory, `${sanitizeFilename(stem)}_refs`);
  }
  return path.join(path.resolve(cwd), `${projectName}_refs`);
}

export function defaultUserDataDir(channel, platform = process.platform, env = process.env) {
  const normalized = normalizeBrowserChannel(channel);
  const homeDir = os.homedir();

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
    return normalized === "msedge"
      ? path.join(localAppData, "Microsoft", "Edge", "User Data")
      : path.join(localAppData, "Google", "Chrome", "User Data");
  }

  if (platform === "darwin") {
    return normalized === "msedge"
      ? path.join(homeDir, "Library", "Application Support", "Microsoft Edge")
      : path.join(homeDir, "Library", "Application Support", "Google", "Chrome");
  }

  return normalized === "msedge"
    ? path.join(homeDir, ".config", "microsoft-edge")
    : path.join(homeDir, ".config", "google-chrome");
}

export function resolveBrowserRuntime(browserConfig) {
  const channel = normalizeBrowserChannel(browserConfig.channel);
  const userDataDir = browserConfig.userDataDir
    ? path.resolve(browserConfig.userDataDir)
    : defaultUserDataDir(channel);
  const launchArgs = [];

  if (browserConfig.profileDirectory) {
    launchArgs.push(`--profile-directory=${browserConfig.profileDirectory}`);
  }
  if (browserConfig.disableExtensions) {
    launchArgs.push("--disable-extensions");
  }

  return {
    channel,
    userDataDir,
    executablePath: browserConfig.executablePath ? path.resolve(browserConfig.executablePath) : "",
    headless: Boolean(browserConfig.headless),
    slowMoMs: Number(browserConfig.slowMoMs || 0),
    launchArgs
  };
}
