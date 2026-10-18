const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { generateSchema, writeSchema, dialects } = require("../src");
const { getDialect } = require("../src/dialects");
const { writeTemp } = require("./helpers");

const dbml = "Table users {\n  id int [pk]\n}\n";

test("pg is the default dialect", () => {
  assert.equal(generateSchema(dbml), generateSchema(dbml, { dialect: "pg" }));
});

test("an unsupported dialect lists the supported ones", () => {
  assert.throws(() => generateSchema(dbml, { dialect: "mysql" }), {
    message: "Unsupported dialect 'mysql'. Supported: pg, d1",
  });
});

test("dialects lists the registered targets", () => {
  assert.deepEqual(dialects, ["pg", "d1"]);
});

test("d1 is selected with { dialect: \"d1\" }", () => {
  assert.equal(getDialect("d1").id, "d1");
  assert.match(generateSchema(dbml, { dialect: "d1" }), /sqliteTable\("users"/);
});

test("writeSchema writes nothing for an unsupported dialect", () => {
  const { dir, file } = writeTemp("db.dbml", dbml);

  assert.throws(() => writeSchema(file, { dialect: "mysql" }), /Unsupported dialect/);
  assert.deepEqual(fs.readdirSync(dir), ["db.dbml"]);
});

test("writeSchema writes <name>.schema.ts by default and replaces it", () => {
  const { dir, file } = writeTemp("db.dbml", dbml);
  const outPath = path.join(dir, "db.schema.ts");
  fs.writeFileSync(outPath, "old");

  assert.equal(writeSchema(file), outPath);
  assert.equal(fs.readFileSync(outPath, "utf8"), generateSchema(dbml, { sourceName: "db.dbml" }));
});

test("writeSchema refuses to overwrite the source", () => {
  const { file } = writeTemp("db.dbml", dbml);

  assert.throws(() => writeSchema(file, { outPath: file }), /must differ from the source/);
});
