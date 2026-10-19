const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { pathToFileURL } = require("url");
const { generateSchema } = require("../src");

const root = path.join(__dirname, "..");

/**
 * Writes `text` to `<new temp folder>/<name>` and returns both paths.
 */
function writeTemp(name, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbml2drizzle-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return { dir, file };
}

/**
 * Generated PostgreSQL schema for `dbml`.
 */
function generate(dbml) {
  return generateSchema(dbml, { sourceName: "test.dbml" });
}

let loaded = 0;

/**
 * Imports generated schema source as an ES module. The file is written
 * inside the repository so that `drizzle-orm` resolves, and removed after.
 * The TypeScript-only syntax the generator emits is removed so the source
 * runs as JavaScript (also on Node.js 20, which cannot strip types): `as
 * const` on D1 enum values, and the typed callbacks of references in a cycle
 * with their `import type` line.
 */
async function loadGenerated(text) {
  const dir = path.join(__dirname, "..", "tmp", "generated");
  const file = path.join(dir, `schema-${process.pid}-${++loaded}.mjs`);
  const javascript = text
    .replace(/ as const;$/gm, ";")
    .replace(/^import type .*;\r?\n/gm, "")
    .replace(/\(\): Any(?:Pg|SQLite)Column =>/g, "() =>");

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, javascript);

  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/**
 * SQL statements drizzle-kit generates for the schema source, starting from
 * an empty database.
 */
async function sqlFor(text) {
  const api = await import("drizzle-kit/api");
  const module = await loadGenerated(text);
  const statements = await api.generateMigration(await api.generateDrizzleJson({}), await api.generateDrizzleJson(module));
  return statements.join("\n");
}

/**
 * SQLite (Cloudflare D1) statements drizzle-kit generates for the schema
 * source, starting from an empty database.
 */
async function sqliteSqlFor(text) {
  const api = await import("drizzle-kit/api");
  const module = await loadGenerated(text);
  const statements = await api.generateSQLiteMigration(
    await api.generateSQLiteDrizzleJson({}),
    await api.generateSQLiteDrizzleJson(module)
  );
  return statements.join("\n");
}

let tarball;

/**
 * Runs `command` in `cwd` and returns its stdout, throwing with stderr when
 * it fails. `shell` is needed on Windows to run npm.cmd.
 */
function run(command, args, cwd, shell = false) {
  const result = spawnSync(command, args, { cwd, shell, encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.error}`);
  }

  return result.stdout;
}

/**
 * Installs the package as users get it into `tmp/consumers/<kind>/`: packs
 * it once per process (`npm pack` also runs `prepack`) and extracts a copy
 * into `node_modules/dbml2drizzle`. A copy, not a link, so removing the
 * consumer folder can never touch the repository. Returns the folder.
 */
function installPacked(kind) {
  const consumers = path.join(root, "tmp", "consumers");
  const dir = path.join(consumers, kind);
  const target = path.join(dir, "node_modules", "dbml2drizzle");

  if (!tarball) {
    fs.mkdirSync(consumers, { recursive: true });
    const name = run("npm", ["pack", "--pack-destination", "tmp/consumers"], root, true).trim().split(/\r?\n/).pop();
    tarball = path.join(consumers, name);
  }

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  // relative, with forward slashes: GNU tar reads "C:" as a host name
  run("tar", ["-xzf", path.relative(target, tarball).split(path.sep).join("/"), "--strip-components=1"], target);

  return dir;
}

module.exports = { writeTemp, generate, loadGenerated, sqlFor, sqliteSqlFor, installPacked };
