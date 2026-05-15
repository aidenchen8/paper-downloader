import { parseCliArgs, printUsage } from "./lib/cli.mjs";
import { runRefDownloader } from "./lib/pipeline.mjs";

const usage = [
  "Usage:",
  "  node scripts/run-paper-downloader.mjs <doi-or-document> [--output-dir <path>] [--config <path>]",
  "    [--browser chrome|msedge] [--profile <name>] [--user-data-dir <path>]",
  "    [--headless] [--yes] [--auto] [--refresh-extract]",
  "    [--oa-only|--skip-browser] [--no-oa] [--publisher-direct-fetch]",
  "    [--no-authenticated-direct-fetch] [--no-manual-queue]"
];

async function main() {
  const { options, positionals } = parseCliArgs();
  if (options.help || positionals.length === 0) {
    printUsage(usage);
    return;
  }

  await runRefDownloader(positionals[0], options);
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exitCode = 1;
});
