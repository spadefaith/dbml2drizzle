const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { writeTemp, writeSnapshotTemp } = require("./helpers");

const bin = path.join(__dirname, "..", "bin", "dbml2sequelize.js");
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });

const dbml = `Table accounts {
  id integer [pk, increment]
}`;

test("migrate writes the migration and prints its path", () => {
  const { dir, file } = writeTemp("db.dbml", dbml);
  const outDir = path.join(dir, "migrations");

  const result = run("migrate", file, "--out", outDir, "--name", "first");

  assert.equal(result.status, 0, result.stderr);
  const printed = result.stdout.trim();
  assert.ok(fs.existsSync(printed));
  assert.equal(path.dirname(printed), outDir);
  assert.match(path.basename(printed), /^\d{14}-first\.js$/);
});

test("migrate on a missing file exits 2 and writes nothing", () => {
  const { dir } = writeTemp("unused.txt", "");
  const outDir = path.join(dir, "migrations");

  const result = run("migrate", path.join(dir, "missing.dbml"), "--out", outDir);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing\.dbml/);
  assert.equal(fs.existsSync(outDir), false);
});

test("migrate on DBML with problems exits 1, lists all of them and writes nothing", () => {
  const { dir, file } = writeTemp(
    "bad.dbml",
    `Table a {
  id integer [pk]
  amount money
  kind enum()
  owner_id integer [ref: > owners.id]
}`
  );
  const outDir = path.join(dir, "migrations");

  const result = run("migrate", file, "--out", outDir);

  assert.equal(result.status, 1);
  assert.deepEqual(result.stderr.trim().split(/\r?\n/), [
    "line 3: a.amount: Unsupported data type 'money'",
    "line 4: a.kind: enum must have at least one value",
    "line 5: a.owner_id: References unknown table 'owners'",
  ]);
  assert.equal(fs.existsSync(outDir), false);
});

test("patch writes db-patch.dbml and prints its path", () => {
  const { dir, file } = writeTemp("db.dbml", `Table accounts {
  id integer [pk]
  created_by integer [ref: > accounts.id, delete: set null]
}`);

  const result = run("patch", file);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), path.join(dir, "db-patch.dbml"));
  assert.match(fs.readFileSync(path.join(dir, "db-patch.dbml"), "utf8"), /Ref: accounts\.created_by > accounts\.id \[delete: set null\]/);

  const outPath = path.join(dir, "docs.dbml");
  assert.equal(run("patch", file, "--out", outPath).status, 0);
  assert.ok(fs.existsSync(outPath));
  assert.deepEqual(fs.readdirSync(dir).sort(), ["db-patch.dbml", "db.dbml", "docs.dbml"]);
});

test("patch on DBML with problems exits 1 and writes nothing", () => {
  const { dir, file } = writeTemp("db.dbml", `Table a {
  id money
}`);

  const result = run("patch", file);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /line 2: a\.id: Unsupported data type 'money'/);
  assert.deepEqual(fs.readdirSync(dir), ["db.dbml"]);
});

test("--help prints usage and exits 0; no command exits 2", () => {
  const help = run("--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /dbml2sequelize migrate <file\.dbml>/);

  assert.equal(run().status, 2);
  assert.equal(run("unknown").status, 2);
});

// baseline and the migrate snapshot (specs/003-incremental-migrations/contracts/cli.md)

test("baseline prints the snapshot path, and a following diff reports no changes", () => {
  const { dir, file } = writeTemp("db.dbml", dbml);
  const outDir = path.join(dir, "migrations");

  const baseline = run("baseline", file, "--out", outDir);

  assert.equal(baseline.status, 0, baseline.stderr);
  assert.equal(baseline.stdout.trim(), path.join(outDir, "dbml2sequelize-snapshot.json"));

  const diff = run("diff", file, "--out", outDir);
  assert.equal(diff.status, 0, diff.stderr);
  assert.equal(diff.stdout.trim(), "No changes.");
});

test("migrate prints only the migration path, and refuses a second run without --overwrite-snapshot", () => {
  const { dir, file } = writeTemp("db.dbml", dbml);
  const outDir = path.join(dir, "migrations");
  const snapshotPath = path.join(outDir, "dbml2sequelize-snapshot.json");

  const first = run("migrate", file, "--out", outDir);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout.trim().split("\n").length, 1);
  assert.ok(fs.existsSync(snapshotPath));

  const second = run("migrate", file, "--out", outDir);
  assert.equal(second.status, 2);
  assert.equal(
    second.stderr.trim(),
    `${snapshotPath} already exists. Use "dbml2sequelize diff" for schema changes, or pass --overwrite-snapshot to start over.`
  );
  assert.equal(fs.readdirSync(outDir).length, 2);

  const third = run("migrate", file, "--out", outDir, "--name", "restart", "--overwrite-snapshot");
  assert.equal(third.status, 0, third.stderr);
  assert.equal(fs.readdirSync(outDir).length, 3);
});

test("--help lists every command", () => {
  const help = run("--help");

  for (const command of ["migrate", "diff", "baseline", "patch"]) {
    assert.match(help.stdout, new RegExp(`dbml2sequelize ${command} <file\\.dbml>`));
  }
});

// diff (specs/003-incremental-migrations/contracts/cli.md)

const users = `Table users {
  id integer [pk, increment]
  name varchar(50) [note: 'full name']
}
`;

test("diff writes the migration for the changes and prints its path", () => {
  const { dir, file } = writeSnapshotTemp(users);
  fs.writeFileSync(file, users.replace("varchar(50)", "varchar(80)"));

  const result = run("diff", file, "--out", path.join(dir, "migrations"), "--name", "widen-name");

  assert.equal(result.status, 0, result.stderr);
  const printed = result.stdout.trim();
  assert.ok(fs.existsSync(printed));
  assert.match(path.basename(printed), /^\d{14}-widen-name\.js$/);
});

test("diff with no changes prints No changes. and writes nothing", () => {
  const { dir, file } = writeSnapshotTemp(users);
  const result = run("diff", file, "--out", path.join(dir, "migrations"));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "No changes.");
  assert.deepEqual(fs.readdirSync(path.join(dir, "migrations")), ["dbml2sequelize-snapshot.json"]);
});

test("diff honors --snapshot", () => {
  const { dir, file, snapshotPath } = writeSnapshotTemp(users);
  const moved = path.join(dir, "elsewhere.json");
  fs.renameSync(snapshotPath, moved);
  fs.writeFileSync(file, users.replace("varchar(50)", "varchar(80)"));

  const result = run("diff", file, "--out", path.join(dir, "migrations"), "--snapshot", moved);

  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(moved, "utf8"), /"args": \[\s*80\s*\]/);
});

test("diff without a snapshot exits 2 and points to baseline", () => {
  const { dir, file } = writeTemp("db.dbml", users);
  const result = run("diff", file, "--out", path.join(dir, "migrations"));

  assert.equal(result.status, 2);
  assert.match(result.stderr, /dbml2sequelize-snapshot\.json not found\. Run "dbml2sequelize baseline <file\.dbml>" first\./);
  assert.deepEqual(fs.readdirSync(dir), ["db.dbml"]);
});

test("diff with an invalid snapshot exits 2", () => {
  const { dir, file, snapshotPath } = writeSnapshotTemp(users);
  fs.writeFileSync(snapshotPath, "{ not json");

  const result = run("diff", file, "--out", path.join(dir, "migrations"));

  assert.equal(result.status, 2);
  assert.match(result.stderr, /is not a valid snapshot/);
});

test("diff refuses data-loss changes with exit 3 and leaves the snapshot untouched", () => {
  const { dir, file, snapshotPath } = writeSnapshotTemp(`${users}\nTable logs {\n  id integer [pk]\n}\n`);
  const snapshot = fs.readFileSync(snapshotPath, "utf8");
  fs.writeFileSync(file, users);

  const refused = run("diff", file, "--out", path.join(dir, "migrations"));

  assert.equal(refused.status, 3);
  assert.match(refused.stderr, /^Refused: these changes can lose data \(pass --allow-data-loss to generate them\):\nlogs: table removed/);
  assert.equal(fs.readFileSync(snapshotPath, "utf8"), snapshot);

  const allowed = run("diff", file, "--out", path.join(dir, "migrations"), "--allow-data-loss");

  assert.equal(allowed.status, 0, allowed.stderr);
  assert.ok(fs.existsSync(allowed.stdout.trim()));
});

test("diff exits 1 on unsupported changes and ends with the safe order", () => {
  const { dir, file } = writeSnapshotTemp(users);
  fs.writeFileSync(file, users.replace(" [note: 'full name']", ""));

  const result = run("diff", file, "--out", path.join(dir, "migrations"));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /line 3: users\.name: Removing a column note is not supported by Sequelize migrations/);
  assert.match(result.stderr, /5\. run "dbml2sequelize baseline"\.\s*$/);
});
