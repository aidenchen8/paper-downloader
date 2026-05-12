import path from "node:path";

import { parseCliArgs, printUsage } from "./lib/cli.mjs";
import { extractRefsFromDocumentStage, extractRefsStage, loadRuntimeConfig } from "./lib/pipeline.mjs";
import { sanitizeFilename, sanitizeProjectName } from "./lib/paths.mjs";
import { resolveInputSource } from "./lib/source-input.mjs";

const usage = [
  "Usage:",
  "  node scripts/extract-refs.mjs <doi-or-document> [--output-dir <path>] [--config <path>]"
];

async function main() {
  const { options, positionals } = parseCliArgs();
  if (options.help || positionals.length === 0) {
    printUsage(usage);
    return;
  }

  const resolvedInput = await resolveInputSource(positionals[0]);
  const projectName = resolvedInput.inputKind === "doi"
    ? sanitizeProjectName(resolvedInput.doi)
    : sanitizeFilename(path.basename(resolvedInput.inputPath, path.extname(resolvedInput.inputPath))) || "document";
  const outputDir = path.resolve(options.outputDir || `${projectName}_refs`);
  const { config } = await loadRuntimeConfig(options);
  const result = resolvedInput.inputKind === "doi"
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

  process.stdout.write(`Wrote ${result.paths.rawRefsPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exitCode = 1;
});
