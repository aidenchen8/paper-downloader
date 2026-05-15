function optionNameFromFlag(flag) {
  return flag.replace(/^--/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

const BOOLEAN_FLAGS = new Set([
  "auto",
  "headless",
  "help",
  "noAuthenticatedDirectFetch",
  "noManualQueue",
  "noOa",
  "oaOnly",
  "publisherDirectFetch",
  "refreshExtract",
  "skipBrowser",
  "yes"
]);

export function parseCliArgs(argv = process.argv.slice(2)) {
  const options = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    const [flagPart, inlineValue] = token.split("=", 2);
    const name = optionNameFromFlag(flagPart);

    if (BOOLEAN_FLAGS.has(name)) {
      options[name] = inlineValue === undefined ? true : inlineValue === "true";
      continue;
    }

    if (inlineValue !== undefined) {
      options[name] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${flagPart}`);
    }

    options[name] = next;
    index += 1;
  }

  return { options, positionals };
}

export function printUsage(lines) {
  process.stdout.write(`${lines.join("\n")}\n`);
}
