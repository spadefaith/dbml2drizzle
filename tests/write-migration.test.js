const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { writeMigration } = require("../src");
const { writeTemp } = require("./helpers");

const dbml = `Table accounts {
  id integer [pk, increment]
}`;

const date = new Date(Date.UTC(2026, 9, 17, 8, 5, 9));

test("writes <YYYYMMDDHHmmss>-init-schema.js into a new folder", () => {
  const { dir, file } = writeTemp("db.dbml", dbml);
  const outDir = path.join(dir, "migrations", "nested");

  const written = writeMigration(file, { outDir, date });

  assert.equal(written, path.join(outDir, "20261017080509-init-schema.js"));
  assert.ok(fs.existsSync(written));
  assert.match(fs.readFileSync(written, "utf8"), /createTable\(\s*"accounts"/);
});

test("honours the name option and writes no db-patch.dbml", () => {
  const { dir, file } = writeTemp("db.dbml", dbml);
  const outDir = path.join(dir, "out");

  const written = writeMigration(file, { outDir, name: "create-accounts", date });

  assert.equal(path.basename(written), "20261017080509-create-accounts.js");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["db.dbml", "out"]);
  // the snapshot for incremental migrations sits next to the migration (feature 003)
  assert.deepEqual(fs.readdirSync(outDir), ["20261017080509-create-accounts.js", "dbml2sequelize-snapshot.json"]);
});
