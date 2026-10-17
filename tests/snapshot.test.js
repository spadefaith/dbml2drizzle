const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { generateSnapshot, generateMigration, writeBaseline, writeMigration, SnapshotError } = require("../src");
const { readSnapshot, readSnapshotFile } = require("../src/snapshot/read-snapshot");
const { writeTemp } = require("./helpers");

const dbml = `Table users {
  id integer [pk, increment]
  email varchar(120) [not null, unique, note: 'login']
  status enum('active', 'paused') [default: 'active']
}

Table posts {
  id integer [pk, increment]
  user_id integer [ref: > users.id, delete: cascade]

  indexes {
    user_id
  }
}
`;

// contracts/snapshot-file.md
const expected = {
  format: 1,
  source: "db.dbml",
  schema: {
    tables: [
      {
        name: "users",
        comment: "",
        columns: [
          { name: "id", type: { name: "INTEGER", args: [] }, primaryKey: true, autoIncrement: true },
          { name: "email", type: { name: "STRING", args: [120] }, allowNull: false, unique: true, comment: "login" },
          { name: "status", type: { name: "ENUM", args: ["active", "paused"] }, defaultValue: { kind: "value", value: "active" } },
        ],
        indexes: [],
      },
      {
        name: "posts",
        comment: "",
        columns: [
          { name: "id", type: { name: "INTEGER", args: [] }, primaryKey: true, autoIncrement: true },
          { name: "user_id", type: { name: "INTEGER", args: [] } },
        ],
        indexes: [{ fields: ["user_id"], name: "posts_user_id" }],
      },
    ],
    relationships: [
      {
        from: { table: "posts", columns: ["user_id"] },
        to: { table: "users", columns: ["id"] },
        kind: "many-to-one",
        composite: false,
        onDelete: "CASCADE",
      },
    ],
  },
};

test("the snapshot holds the schema of the DBML, as in the contract", () => {
  const text = generateSnapshot(dbml, { source: "db.dbml" });

  assert.deepEqual(JSON.parse(text), expected);
  assert.equal(text, JSON.stringify(expected, null, 2) + "\n");
});

// renamedFrom is checked in renames.test.js, with the directive
test("the snapshot has no source locations or patch edits", () => {
  const text = generateSnapshot(
    `Table a {\n  id integer [pk]\n  b_id integer [ref: > b.id, delete: cascade]\n}\n\nTable b {\n  id integer [pk]\n  Note: { 'b' }\n}\n`
  );

  for (const key of ["line", "declaredAt", "patchEdits"]) {
    assert.doesNotMatch(text, new RegExp(`"${key}"`), key);
  }
});

test("the same schema always gives the same snapshot", () => {
  const moved = `// a comment\n\n\n${dbml.replace("Table posts", "// spacer\n\nTable posts")}`;

  assert.equal(generateSnapshot(dbml), generateSnapshot(dbml));
  assert.equal(generateSnapshot(moved), generateSnapshot(dbml));
});

test("readSnapshot returns the schema", () => {
  assert.deepEqual(readSnapshot(generateSnapshot(dbml), "snap.json"), expected.schema);
});

test("readSnapshot rejects invalid JSON, a missing format and an unsupported format", () => {
  const cases = [
    ["{ not json", "invalid"],
    [JSON.stringify({ schema: expected.schema }), "invalid"],
    [JSON.stringify({ format: "1", schema: expected.schema }), "invalid"],
    [JSON.stringify({ format: 2, schema: expected.schema }), "unsupported"],
  ];

  for (const [text, reason] of cases) {
    assert.throws(
      () => readSnapshot(text, "snap.json"),
      (error) => error instanceof SnapshotError && error.reason == reason && error.path == "snap.json",
      text
    );
  }
});

test("readSnapshotFile on a missing file points to baseline", () => {
  const { dir } = writeTemp("db.dbml", dbml);
  const missing = path.join(dir, "migrations", "dbml2sequelize-snapshot.json");

  assert.throws(
    () => readSnapshotFile(missing),
    (error) =>
      error instanceof SnapshotError &&
      error.reason == "missing" &&
      error.message == `${missing} not found. Run "dbml2sequelize baseline <file.dbml>" first.`
  );
  assert.equal(fs.existsSync(missing), false);
});

// Files: baseline and migrate (US4)

const SNAPSHOT = "dbml2sequelize-snapshot.json";
const date = new Date(Date.UTC(2026, 9, 17, 8, 30, 0));

test("writeBaseline writes the snapshot, replaces it on a second run, and writes no migration", () => {
  const { dir, file } = writeTemp("db.dbml", dbml);
  const outDir = path.join(dir, "migrations");

  const written = writeBaseline(file, { outDir });
  assert.equal(written, path.join(outDir, SNAPSHOT));
  assert.equal(fs.readFileSync(written, "utf8"), generateSnapshot(dbml, { source: "db.dbml" }));

  const changed = dbml.replace("varchar(120)", "varchar(200)");
  fs.writeFileSync(file, changed);
  writeBaseline(file, { outDir });

  assert.equal(fs.readFileSync(written, "utf8"), generateSnapshot(changed, { source: "db.dbml" }));
  assert.deepEqual(fs.readdirSync(outDir), [SNAPSHOT]);
});

test("writeBaseline honors snapshotPath", () => {
  const { dir, file } = writeTemp("db.dbml", dbml);
  const snapshotPath = path.join(dir, "state", "schema.json");

  assert.equal(writeBaseline(file, { snapshotPath }), snapshotPath);
  assert.ok(fs.existsSync(snapshotPath));
});

test("writeMigration also writes the snapshot, and the migration is unchanged", () => {
  const { dir, file } = writeTemp("db.dbml", dbml);
  const outDir = path.join(dir, "migrations");

  const migration = writeMigration(file, { outDir, date });

  assert.equal(fs.readFileSync(migration, "utf8"), generateMigration(dbml, { source: "db.dbml" }));
  assert.equal(fs.readFileSync(path.join(outDir, SNAPSHOT), "utf8"), generateSnapshot(dbml, { source: "db.dbml" }));
});

test("writeMigration refuses to overwrite an existing snapshot and writes nothing", () => {
  const { dir, file } = writeTemp("db.dbml", dbml);
  const outDir = path.join(dir, "migrations");
  writeBaseline(file, { outDir });
  const snapshot = fs.readFileSync(path.join(outDir, SNAPSHOT), "utf8");
  fs.writeFileSync(file, dbml.replace("varchar(120)", "varchar(200)"));

  assert.throws(
    () => writeMigration(file, { outDir, date }),
    (error) =>
      error instanceof SnapshotError &&
      error.reason == "exists" &&
      error.message ==
        `${path.join(outDir, SNAPSHOT)} already exists. Use "dbml2sequelize diff" for schema changes, or pass --overwrite-snapshot to start over.`
  );
  assert.deepEqual(fs.readdirSync(outDir), [SNAPSHOT]);
  assert.equal(fs.readFileSync(path.join(outDir, SNAPSHOT), "utf8"), snapshot);
});

test("writeMigration with overwriteSnapshot writes both", () => {
  const { dir, file } = writeTemp("db.dbml", dbml);
  const outDir = path.join(dir, "migrations");
  writeBaseline(file, { outDir });
  const changed = dbml.replace("varchar(120)", "varchar(200)");
  fs.writeFileSync(file, changed);

  const migration = writeMigration(file, { outDir, date, overwriteSnapshot: true });

  assert.ok(fs.existsSync(migration));
  assert.equal(fs.readFileSync(path.join(outDir, SNAPSHOT), "utf8"), generateSnapshot(changed, { source: "db.dbml" }));
});
