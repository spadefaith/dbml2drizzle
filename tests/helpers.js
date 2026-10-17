const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { generateSchema } = require("../src");

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
 */
async function loadGenerated(text) {
  const dir = path.join(__dirname, "..", "tmp", "generated");
  const file = path.join(dir, `schema-${process.pid}-${++loaded}.mjs`);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, text);

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

module.exports = { writeTemp, generate, loadGenerated, sqlFor };
