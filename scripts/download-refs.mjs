import { parseCliArgs, printUsage } from "./lib/cli.mjs";
import { downloadRefsStage, loadRuntimeConfig } from "./lib/pipeline.mjs";

const usage = [
  "Usage:",
  "  node scripts/download-refs.mjs <project-dir-or-refs_validated.json> [--config <path>]",
  "    [--browser chrome|msedge] [--profile <name>] [--user-data-dir <path>] [--headless] [--auto]",
  "    [--oa-only|--skip-browser] [--no-oa] [--publisher-direct-fetch]",
  "    [--no-authenticated-direct-fetch] [--no-manual-queue]"
];

async function main() {
  const { options, positionals } = parseCliArgs();
  if (options.help || positionals.length === 0) {
    printUsage(usage);
    return;
  }

  const { config } = await loadRuntimeConfig(options);
  const result = await downloadRefsStage({
    projectArg: positionals[0],
    config,
    auto: Boolean(options.auto)
  });
  process.stdout.write(`Wrote ${result.projectDir}/download_report.csv\n`);
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exitCode = 1;
});
