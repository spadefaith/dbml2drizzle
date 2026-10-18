const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { generateSchema, generateDbPatch } = require("../src");
const { writeTemp } = require("./helpers");

const bin = path.join(__dirname, "..", "bin", "dbml2drizzle.js");
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });

const users = `Table users {
  id int [pk, increment]
  email varchar(255) [not null]
}
`;

test("schema writes <name>.schema.ts next to the DBML and prints the path", () => {
  const { dir, file } = writeTemp("db.dbml", users);
  const result = run("schema", file);
  const outPath = path.join(dir, "db.schema.ts");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), outPath);
  assert.equal(fs.readFileSync(outPath, "utf8"), generateSchema(users, { sourceName: "db.dbml" }));
});

test("schema honors --out and --dialect pg", () => {
  const { dir, file } = writeTemp("db.dbml", users);
  const outPath = path.join(dir, "src", "db", "schema.ts");
  const result = run("schema", file, "--out", outPath, "--dialect", "pg");

  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(outPath));
});

test("schema --dialect d1 writes the Cloudflare D1 schema and prints the path", () => {
  const { dir, file } = writeTemp("db.dbml", users);
  const result = run("schema", file, "--dialect", "d1");
  const outPath = path.join(dir, "db.schema.ts");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), outPath);
  assert.equal(fs.readFileSync(outPath, "utf8"), generateSchema(users, { dialect: "d1", sourceName: "db.dbml" }));
  assert.match(fs.readFileSync(outPath, "utf8"), /from "drizzle-orm\/sqlite-core";/);
});

test("an unsupported dialect exits 2 and writes nothing", () => {
  const { dir, file } = writeTemp("db.dbml", users);
  const result = run("schema", file, "--dialect", "mysql");

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unsupported dialect 'mysql'\. Supported: pg, d1$/m);
  assert.deepEqual(fs.readdirSync(dir), ["db.dbml"]);
});

test("DBML errors exit 1, one per line on stderr, and write nothing", () => {
  const { dir, file } = writeTemp("db.dbml", "Table a {\n  b money\n  c int [renamed_from: 'd']\n}\n");
  const result = run("schema", file);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /^line 2: a\.b: Unsupported data type 'money'$/m);
  assert.match(result.stderr, /^line 3: a\.c: renamed_from is no longer supported/m);
  assert.deepEqual(fs.readdirSync(dir), ["db.dbml"]);
});

test("patch writes the dbdocs copy as before", () => {
  const dbml = "Table users {\n  id int [pk]\n}\nTable posts {\n  user_id int [ref: > users.id, delete: cascade]\n}\n";
  const { dir, file } = writeTemp("db.dbml", dbml);
  const result = run("patch", file);
  const outPath = path.join(dir, "db-patch.dbml");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), outPath);
  assert.equal(fs.readFileSync(outPath, "utf8"), generateDbPatch(dbml));
});

test("removed commands exit 2 with usage pointing to drizzle-kit", () => {
  const { file } = writeTemp("db.dbml", users);

  for (const command of ["migrate", "diff", "baseline"]) {
    const result = run(command, file);
    assert.equal(result.status, 2);
    assert.match(result.stderr, new RegExp(`Unknown command '${command}'`));
    assert.match(result.stderr, /drizzle-kit generate/);
  }
});

test("missing file and bad options exit 2", () => {
  assert.equal(run("schema").status, 2);
  assert.equal(run("schema", "x.dbml", "--nope").status, 2);
});

test("--help prints usage and exits 0", () => {
  const result = run("--help");

  assert.equal(result.status, 0);
  assert.match(result.stdout, /dbml2drizzle schema <file\.dbml>/);
  assert.match(result.stdout, /dbml2drizzle patch <file\.dbml>/);
  assert.match(result.stdout, /supported: pg, d1/);
});
