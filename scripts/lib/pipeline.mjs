import fs from "node:fs/promises";
import path from "node:path";

import { applyCliOverrides, loadConfig, warnIfPlaceholderMailto } from "./config.mjs";
import { enrichReference, extractReferencesForDoi } from "./crossref.mjs";
import { extractReferencesFromDocument } from "./document-references.mjs";
import { downloadValidatedReferences } from "./browser-downloader.mjs";
import { ensureDir, nowIso, pathExists, promptLine, readJson, sleep, writeJson } from "./io.mjs";
import { buildProjectPaths, resolveBrowserRuntime, resolveOutputDir, sanitizeFilename, sanitizeProjectName } from "./paths.mjs";
import { finalizeReferenceRecord } from "./reference-routing.mjs";
import { resolveInputSource } from "./source-input.mjs";

function summarizeByStatus(items, field = "status") {
  return items.reduce((summary, item) => {
    const key = item[field] || "unknown";
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});
}

function printClosingPromo() {
  process.stdout.write("\n>>> keep-in-touch\n");
  process.stdout.write("  如果你愿意继续交流，我会分享更多的 AI 使用小技巧。\n");
  process.stdout.write("  公众号：AI-Aiden\n");
  process.stdout.write("  小红书：Aiden https://xhslink.com/m/3NwsDRr2xce\n");
  process.stdout.write("  微博：AI-Aiden https://weibo.com/u/3270415111\n");
}

async function resolveProjectDir(arg) {
  const candidate = path.resolve(arg);
  if (await pathExists(candidate)) {
    const stats = await fs.stat(candidate);
    if (stats.isDirectory()) {
      return candidate;
    }
    if (stats.isFile()) {
      return path.dirname(candidate);
    }
  }

  const nested = path.resolve(process.cwd(), arg);
  if (await pathExists(nested)) {
    const stats = await fs.stat(nested);
    if (stats.isDirectory()) {
      return nested;
    }
    if (stats.isFile()) {
      return path.dirname(nested);
    }
  }

  throw new Error(`Could not resolve project path: ${arg}`);
}

async function updateProjectMeta(metaPath, patch) {
  const existing = (await readJson(metaPath, {})) || {};
  await writeJson(metaPath, {
    ...existing,
    ...patch
  });
}

export async function loadRuntimeConfig(options = {}) {
  const loaded = await loadConfig({ cliConfigPath: options.config || "" });
  const config = applyCliOverrides(loaded.config, options);
  warnIfPlaceholderMailto(config);
  return {
    config,
    configPaths: loaded.paths
  };
}

export async function extractRefsStage({ doi, outputDir, projectName, config, sourceInput }) {
  const paths = buildProjectPaths(outputDir, projectName);
  await ensureDir(paths.projectDir);

  const extracted = await extractReferencesForDoi(doi, config.crossref.mailto);
  const payload = {
    source_doi: extracted.doi,
    source_title: extracted.title,
    source_input: sourceInput,
    project_name: projectName,
    extracted_at: nowIso(),
    reference_count: extracted.references.length,
    references: extracted.references
  };

  await writeJson(paths.rawRefsPath, payload);
  await updateProjectMeta(paths.metaPath, {
    project_name: projectName,
    output_dir: paths.outputDir,
    project_dir: paths.projectDir,
    source_doi: extracted.doi,
    source_title: extracted.title,
    source_input: sourceInput,
    updated_at: nowIso()
  });

  return {
    paths,
    data: payload
  };
}

export async function extractRefsFromDocumentStage({ filePath, outputDir, projectName }) {
  const paths = buildProjectPaths(outputDir, projectName);
  await ensureDir(paths.projectDir);

  const extracted = await extractReferencesFromDocument(filePath);
  const payload = {
    ...extracted,
    project_name: projectName,
    extracted_at: nowIso()
  };

  await writeJson(paths.rawRefsPath, payload);
  await updateProjectMeta(paths.metaPath, {
    project_name: projectName,
    output_dir: paths.outputDir,
    project_dir: paths.projectDir,
    source_doi: extracted.source_doi,
    source_title: extracted.source_title,
    source_input: filePath,
    source_type: extracted.source_type,
    extraction_mode: extracted.extraction_mode,
    updated_at: nowIso()
  });

  return {
    paths,
    data: payload
  };
}

export async function validateRefsStage({ projectArg, config }) {
  const projectDir = await resolveProjectDir(projectArg);
  const raw = await readJson(path.join(projectDir, "refs_raw.json"));
  if (!raw) {
    throw new Error(`refs_raw.json not found in ${projectDir}`);
  }

  const previous = (await readJson(path.join(projectDir, "refs_validated.json"), { references: [] })) || { references: [] };
  const previousById = new Map(previous.references.map((item) => [item.id, item]));
  const ignoredDois = new Set(config.institution.ignoredAccessDois.map((item) => String(item).toLowerCase()));
  const validatedReferences = [];

  for (const [index, reference] of raw.references.entries()) {
    const previousItem = previousById.get(reference.id);
    const sameSourceText = previousItem?.source_text === (reference.unstructured || "");
    const sameSourceDoi = previousItem?.doi
      ? String(previousItem.doi) === String(reference.doi || "")
      : false;

    if (previousItem && previousItem.status === "verified" && sameSourceText && sameSourceDoi) {
      validatedReferences.push(finalizeReferenceRecord(reference, previousItem));
      continue;
    }

    const enriched = await enrichReference(reference, config.crossref.mailto);
    if (ignoredDois.has(String(enriched.doi || "").toLowerCase())) {
      validatedReferences.push(finalizeReferenceRecord(reference, {
        id: reference.id,
        doi: enriched.doi,
        status: "ignored",
        label: `Ref${String(reference.id).padStart(2, "0")}_Ignored`,
        title: enriched.title || reference.title || "",
        authors: enriched.authors || reference.author || "",
        year: enriched.year || reference.year || 0,
        journal: enriched.journal || reference.journal || "",
        publisher: enriched.publisher || "unknown",
        link: reference.link || "",
        links: reference.links || [],
        source_text: reference.unstructured || "",
        resolution_source: enriched.resolution_source || "",
        error: "Skipped because DOI is listed in institution.ignoredAccessDois"
      }));
      continue;
    }

    validatedReferences.push(finalizeReferenceRecord(reference, enriched));
    if (index < raw.references.length - 1) {
      await sleep(350);
    }
  }

  const payload = {
    source_doi: raw.source_doi,
    source_title: raw.source_title,
    source_input: raw.source_input || "",
    source_type: raw.source_type || (raw.source_input ? "document" : "doi"),
    extraction_mode: raw.extraction_mode || "crossref_references",
    project_name: raw.project_name,
    validated_at: nowIso(),
    summary: summarizeByStatus(validatedReferences),
    references: validatedReferences
  };

  await writeJson(path.join(projectDir, "refs_validated.json"), payload);
  await updateProjectMeta(path.join(projectDir, "project_meta.json"), {
    validated_at: payload.validated_at,
    validation_summary: payload.summary,
    updated_at: nowIso()
  });

  return {
    projectDir,
    data: payload
  };
}

export async function downloadRefsStage({ projectArg, config, auto = false }) {
  const projectDir = await resolveProjectDir(projectArg);
  const validated = await readJson(path.join(projectDir, "refs_validated.json"));
  if (!validated) {
    throw new Error(`refs_validated.json not found in ${projectDir}`);
  }

  const result = await downloadValidatedReferences({
    projectDir,
    validatedData: validated,
    config,
    auto
  });

  await updateProjectMeta(path.join(projectDir, "project_meta.json"), {
    download_report: path.join(projectDir, "download_report.csv"),
    download_summary: result.summaryPath,
    manual_intervention_queue: result.manualQueuePath || "",
    manual_intervention_markdown: result.manualMarkdownPath || "",
    last_run_dir: result.runDir,
    downloaded_at: nowIso(),
    updated_at: nowIso()
  });

  return {
    projectDir,
    ...result
  };
}

export async function runRefDownloader(inputValue, options = {}) {
  const { config } = await loadRuntimeConfig(options);
  const resolvedInput = await resolveInputSource(inputValue);
  const projectName = resolvedInput.inputKind === "doi"
    ? sanitizeProjectName(resolvedInput.doi)
    : sanitizeFilename(path.basename(resolvedInput.inputPath, path.extname(resolvedInput.inputPath))) || "document";
  const outputDir = resolveOutputDir({
    inputKind: resolvedInput.inputKind,
    inputPath: resolvedInput.inputPath,
    projectName,
    explicitOutputDir: options.outputDir
  });
  const paths = buildProjectPaths(outputDir, projectName);
  const browserRuntime = resolveBrowserRuntime(config.browser);

  process.stdout.write("=== paper-downloader ===\n");
  process.stdout.write(`INPUT TYPE:  ${resolvedInput.inputKind}\n`);
  if (resolvedInput.doi) {
    process.stdout.write(`SOURCE DOI:  ${resolvedInput.doi}\n`);
  }
  if (resolvedInput.inputPath) {
    process.stdout.write(`INPUT PATH:  ${resolvedInput.inputPath}\n`);
  }
  process.stdout.write(`PROJECT:     ${projectName}\n`);
  process.stdout.write(`OUTPUT DIR:  ${outputDir}\n`);
  process.stdout.write(`OA FIRST:    ${config.openAccess.enabled ? config.openAccess.providers.join(",") : "disabled"}\n`);
  process.stdout.write(`BROWSER:     ${config.download.browserFallback ? `${browserRuntime.channel} @ ${browserRuntime.userDataDir}` : "disabled"}\n`);

  if (!options.yes) {
    const answer = await promptLine("按回车开始；输入 n 取消: ");
    if (/^n$/i.test(answer)) {
      process.stdout.write("Cancelled.\n");
      return null;
    }
  }

  if (!(await pathExists(paths.rawRefsPath)) || options.refreshExtract) {
    process.stdout.write("\n>>> extract-refs\n");
    const extracted = resolvedInput.inputKind === "doi"
      ? await extractRefsStage({
        doi: resolvedInput.doi,
        outputDir,
        projectName,
        config,
        sourceInput: resolvedInput.doi
      })
      : await extractRefsFromDocumentStage({
        filePath: resolvedInput.inputPath,
        outputDir,
        projectName
      });
    process.stdout.write(`  Title: ${extracted.data.source_title}\n`);
    process.stdout.write(`  References found: ${extracted.data.reference_count}\n`);
  } else {
    process.stdout.write("\n>>> extract-refs\n");
    process.stdout.write("  Skipped: refs_raw.json already exists\n");
  }

  process.stdout.write("\n>>> validate-refs\n");
  const validated = await validateRefsStage({
    projectArg: paths.projectDir,
    config
  });
  process.stdout.write(`  Summary: ${JSON.stringify(validated.data.summary)}\n`);

  process.stdout.write("\n>>> download-refs\n");
  const downloaded = await downloadRefsStage({
    projectArg: paths.projectDir,
    config,
    auto: Boolean(options.auto)
  });
  const reportSummary = summarizeByStatus(downloaded.rows, "pdf_status");
  process.stdout.write(`  Report: ${path.join(paths.projectDir, "download_report.csv")}\n`);
  process.stdout.write(`  Summary file: ${downloaded.summaryPath}\n`);
  if (downloaded.manualQueuePath) {
    process.stdout.write(`  Manual queue: ${downloaded.manualQueuePath} (${downloaded.manualQueue?.length || 0})\n`);
  }
  process.stdout.write(`  Summary: ${JSON.stringify(reportSummary)}\n`);
  if (downloaded.summary?.failed?.length) {
    process.stdout.write(`  Failed refs: ${downloaded.summary.failed.length}\n`);
  }
  printClosingPromo();

  return {
    projectDir: paths.projectDir,
    reportPath: path.join(paths.projectDir, "download_report.csv")
  };
}
