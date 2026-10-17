#!/usr/bin/env node
const { parseArgs } = require("util");
const { writeSchema, writeDbPatch, dialects, DbmlError } = require("../src");

const USAGE = `Usage:
  dbml2drizzle schema <file.dbml> [--out <file.ts>] [--dialect <target>]
      Write the Drizzle schema (default dialect: pg, supported: ${dialects.join(", ")};
      default out: <dir>/<name>.schema.ts).

  dbml2drizzle patch <file.dbml> [--out <file>]
      Write a dbdocs-ready copy of the DBML (default: <dir>/<name>-patch.dbml).

  dbml2drizzle --help

Migrations: run \`drizzle-kit generate\` on the generated schema.`;

const commands = {
  schema: {
    options: { out: { type: "string" }, dialect: { type: "string" } },
    run: (file, values) =>
      writeSchema(file, {
        ...(values.out && { outPath: values.out }),
        ...(values.dialect && { dialect: values.dialect }),
      }),
  },
  patch: {
    options: { out: { type: "string" } },
    run: (file, values) => writeDbPatch(file, values.out ? { outPath: values.out } : {}),
  },
};

function fail(message) {
  console.error(message);
  process.exit(2);
}

function main(argv) {
  const [commandName, ...rest] = argv;

  if (commandName == "--help" || commandName == "-h") {
    console.log(USAGE);
    return;
  }

  const command = commands[commandName];

  if (!command) {
    fail(commandName ? `Unknown command '${commandName}'.\n\n${USAGE}` : USAGE);
  }

  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: command.options, allowPositionals: true });
  } catch (error) {
    fail(`${error.message}\n\n${USAGE}`);
  }

  const [file] = parsed.positionals;

  if (!file) {
    fail(`Missing <file.dbml>.\n\n${USAGE}`);
  }

  if (parsed.values.dialect && !dialects.includes(parsed.values.dialect)) {
    fail(`Unsupported dialect '${parsed.values.dialect}'. Supported: ${dialects.join(", ")}`);
  }

  try {
    console.log(command.run(file, parsed.values));
  } catch (error) {
    if (error instanceof DbmlError) {
      error.message.split("\n").forEach((line) => console.error(line));
      process.exit(1);
    }

    fail(error.message);
  }
}

main(process.argv.slice(2));
