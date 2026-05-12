import { parseCliArgs, printUsage } from "./lib/cli.mjs";
import { loadRuntimeConfig, validateRefsStage } from "./lib/pipeline.mjs";

const usage = [
  "Usage:",
  "  node scripts/validate-refs.mjs <project-dir-or-refs_raw.json> [--config <path>]"
];

async function main() {
  const { options, positionals } = parseCliArgs();
  if (options.help || positionals.length === 0) {
    printUsage(usage);
    return;
  }

  const { config } = await loadRuntimeConfig(options);
  const result = await validateRefsStage({
    projectArg: positionals[0],
    config
  });
  process.stdout.write(`Wrote ${result.projectDir}/refs_validated.json\n`);
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exitCode = 1;
});
