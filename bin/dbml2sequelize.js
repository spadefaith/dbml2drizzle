#!/usr/bin/env node
const { parseArgs } = require("util");
const {
  writeMigration,
  writeDiffMigration,
  writeBaseline,
  writeDbPatch,
  DbmlError,
  DataLossError,
  SnapshotError,
} = require("../src");

const USAGE = `Usage:
  dbml2sequelize migrate <file.dbml> [--out <dir>] [--name <name>] [--snapshot <file>] [--overwrite-snapshot]
      Write the initial Sequelize migration and the snapshot
      (default folder: migrations, name: init-schema, snapshot: <out>/dbml2sequelize-snapshot.json).

  dbml2sequelize diff <file.dbml> [--out <dir>] [--name <name>] [--snapshot <file>] [--allow-data-loss]
      Write a migration with the changes since the snapshot, then replace the snapshot
      (default name: schema-update).

  dbml2sequelize baseline <file.dbml> [--out <dir>] [--snapshot <file>]
      Record the DBML as the snapshot without writing a migration.

  dbml2sequelize patch <file.dbml> [--out <file>]
      Write a dbdocs-ready copy of the DBML (default: <dir>/<name>-patch.dbml).

  dbml2sequelize --help`;

const commands = {
  migrate: {
    options: {
      out: { type: "string" },
      name: { type: "string" },
      snapshot: { type: "string" },
      "overwrite-snapshot": { type: "boolean" },
    },
    run: (file, values) =>
      writeMigration(file, {
        ...(values.out && { outDir: values.out }),
        ...(values.name && { name: values.name }),
        ...(values.snapshot && { snapshotPath: values.snapshot }),
        overwriteSnapshot: Boolean(values["overwrite-snapshot"]),
      }),
  },
  baseline: {
    options: { out: { type: "string" }, snapshot: { type: "string" } },
    run: (file, values) =>
      writeBaseline(file, {
        ...(values.out && { outDir: values.out }),
        ...(values.snapshot && { snapshotPath: values.snapshot }),
      }),
  },
  diff: {
    options: {
      out: { type: "string" },
      name: { type: "string" },
      snapshot: { type: "string" },
      "allow-data-loss": { type: "boolean" },
    },
    run: (file, values) =>
      writeDiffMigration(file, {
        ...(values.out && { outDir: values.out }),
        ...(values.name && { name: values.name }),
        ...(values.snapshot && { snapshotPath: values.snapshot }),
        allowDataLoss: Boolean(values["allow-data-loss"]),
      }) ?? "No changes.",
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

  try {
    console.log(command.run(file, parsed.values));
  } catch (error) {
    if (error instanceof DbmlError) {
      error.message.split("\n").forEach((line) => console.error(line));
      process.exit(1);
    }

    if (error instanceof SnapshotError) {
      fail(error.message);
    }

    if (error instanceof DataLossError) {
      error.message.split("\n").forEach((line) => console.error(line));
      process.exit(3);
    }

    fail(error.message);
  }
}

main(process.argv.slice(2));
