const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  generateSnapshot,
  generateMigration,
  generateDiffMigration,
  writeDiffMigration,
  SnapshotError,
  DbmlError,
} = require("../src");
const { fakeQueryInterface, loadMigration, FakeSequelize, writeSnapshotTemp } = require("./helpers");

const base = `Table users {
  id integer [pk, increment]
  email varchar(120) [not null, unique]
  name varchar(50) [note: 'full name']
  status enum('active', 'paused') [default: 'active']
}

Table posts {
  id integer [pk, increment]
  user_id integer [ref: > users.id, delete: cascade]
  title text

  indexes {
    title
  }
}
`;

const edit = (from, to, text = base) => text.replace(from, to);

function generate(before, after, opts = {}) {
  return generateDiffMigration(generateSnapshot(before), after, opts);
}

async function run(code, step, dialect = "postgres") {
  const queryInterface = fakeQueryInterface({ dialect });
  await loadMigration(code)[step](queryInterface, FakeSequelize);
  return queryInterface.calls;
}

// "method" plus its leading string arguments, e.g. "removeConstraint posts posts_user_id_fkey"
const brief = (call) =>
  [call.method, ...call.args.slice(0, 2).filter((arg) => typeof arg == "string")].join(" ");
const typeOf = (definition) => ({ type: definition.type.type, args: definition.type.args });

test("a new table is created exactly as the initial migration creates it", async () => {
  const after = `${base}\nTable tags {\n  id integer [pk]\n  post_id integer [ref: > posts.id, delete: cascade]\n  label varchar(30) [note: 'shown']\n  Note: 'labels'\n}\n`;
  const diffCreate = (await run(generate(base, after).code, "up")).find((call) => call.method == "createTable");
  const initialCreate = (await run(generateMigration(after), "up")).find(
    (call) => call.method == "createTable" && call.args[0] == "tags"
  );

  // FakeSequelize builds a new function per data type read, so compare by type name and args
  const plain = (value) => JSON.parse(JSON.stringify(value, (key, item) => (typeof item == "function" ? { type: item.type, args: item.args } : item)));
  assert.deepEqual(plain(diffCreate.args), plain(initialCreate.args));
});

test("phases run in order: foreign keys and indexes out, columns, tables, changes, then constraints in", async () => {
  const after = edit("delete: cascade", "delete: set null")
    .replace("  title text\n\n  indexes {\n    title\n  }\n", "  body text\n\n  indexes {\n    body\n  }\n")
    .replace("name varchar(50)", "name varchar(80)")
    .concat("\nTable tags {\n  id integer [pk]\n}\n");
  const { code } = generate(base, after, { allowDataLoss: true });

  assert.deepEqual((await run(code, "up")).map(brief), [
    "removeConstraint posts posts_user_id_fkey",
    "removeIndex posts posts_title",
    "removeColumn posts title",
    "createTable tags",
    "addColumn posts body",
    "changeColumn users name",
    "addConstraint posts",
    "addIndex posts",
  ]);
});

test("new columns get their foreign key through addConstraint, never inline", async () => {
  const after = edit("  title text", "  editor_id integer [ref: > users.id, delete: set null]\n  title text");
  const calls = await run(generate(base, after).code, "up");
  const add = calls.find((call) => call.method == "addColumn");
  const constraint = calls.find((call) => call.method == "addConstraint");

  assert.equal(add.args[2].references, undefined);
  assert.deepEqual(constraint.args[1], {
    type: "foreign key",
    fields: ["editor_id"],
    name: "posts_editor_id_fkey",
    references: { table: "users", field: "id" },
    onDelete: "SET NULL",
    transaction: "tx",
  });
});

test("changeColumn gets only type, allowNull, defaultValue and comment", async () => {
  const before = `Table a {\n  code varchar(10) [pk]\n  name varchar(50) [unique, note: 'label']\n}\n`;
  const after = before.replace("varchar(10)", "varchar(20)").replace("varchar(50)", "varchar(60)");
  const changes = (await run(generate(before, after).code, "up")).filter((call) => call.method == "changeColumn");

  for (const call of changes) {
    for (const key of Object.keys(call.args[2])) {
      assert.ok(["type", "allowNull", "defaultValue", "comment"].includes(key), key);
    }
  }
  assert.equal(changes[0].args[2].allowNull, false, "primary key column");
  assert.equal(changes[1].args[2].comment, "label");
  assert.deepEqual(typeOf(changes[1].args[2]), { type: "STRING", args: [60] });
});

test("enum value changes rebuild the type with Sequelize operations only", async () => {
  const { code } = generate(base, edit("'active', 'paused'", "'active', 'paused', 'closed'"));
  const calls = await run(code, "up");

  assert.deepEqual(calls.map((call) => call.method), ["changeColumn", "dropEnum", "changeColumn", "changeColumn"]);
  assert.deepEqual(typeOf(calls[0].args[2]), { type: "TEXT", args: [] });
  assert.equal("defaultValue" in calls[0].args[2], false);
  assert.deepEqual(calls[1].args, ["enum_users_status", { transaction: "tx" }]);
  assert.deepEqual(typeOf(calls[2].args[2]), { type: "ENUM", args: ["active", "paused", "closed"] });
  assert.equal("defaultValue" in calls[2].args[2], false);
  assert.equal(calls[3].args[2].defaultValue, "active");

  assert.equal((await run(code, "up", "mysql")).some((call) => call.method == "dropEnum"), false);
});

test("enum types left unused are dropped on postgres only", async () => {
  const removed = generate(base, edit("  status enum('active', 'paused') [default: 'active']\n", ""), { allowDataLoss: true });
  assert.deepEqual((await run(removed.code, "up")).map((call) => call.method), ["removeColumn", "dropEnum"]);
  assert.deepEqual((await run(removed.code, "up", "mysql")).map((call) => call.method), ["removeColumn"]);
  assert.deepEqual((await run(removed.code, "down")).map((call) => call.method), ["addColumn"]);

  const twoTables = `Table t {\n  id integer [pk]\n  kind enum('a', 'b')\n}\n\nTable u {\n  id integer [pk]\n}\n`;
  const dropped = generate(twoTables, `Table u {\n  id integer [pk]\n}\n`, { allowDataLoss: true });
  assert.deepEqual((await run(dropped.code, "up")).map(brief), ["dropTable t", "dropEnum enum_t_kind"]);
  assert.deepEqual((await run(dropped.code, "down")).map(brief), ["createTable t"]);

  const fromEnum = generate(base, edit("status enum('active', 'paused') [default: 'active']", "status varchar(10) [default: 'active']"), { allowDataLoss: true });
  assert.deepEqual((await run(fromEnum.code, "up")).map((call) => call.method), ["changeColumn", "dropEnum"]);
  assert.deepEqual((await run(fromEnum.code, "down")).map((call) => call.method), ["changeColumn", "changeColumn"]);
});

test("a column that becomes an enum gets the type first, then its default", async () => {
  const before = `Table t {\n  id integer [pk]\n  kind varchar(10) [default: 'a']\n}\n`;
  const after = before.replace("varchar(10)", "enum('a', 'b')");
  const { code } = generate(before, after, { allowDataLoss: true });
  const up = await run(code, "up");

  assert.deepEqual(up.map((call) => call.method), ["changeColumn", "changeColumn"]);
  assert.equal("defaultValue" in up[0].args[2], false);
  assert.equal(up[1].args[2].defaultValue, "a");
  assert.deepEqual((await run(code, "down")).map((call) => call.method), ["changeColumn", "dropEnum"]);
});

test("a type change on a referenced column removes and re-adds the foreign key around it", async () => {
  const before = `Table a {\n  code varchar(10) [pk]\n}\n\nTable b {\n  id integer [pk]\n  a_code varchar(10) [ref: > a.code]\n}\n`;
  const after = before.replace("code varchar(10) [pk]", "code varchar(20) [pk]");
  const calls = await run(generate(before, after).code, "up");

  assert.deepEqual(calls.map(brief), ["removeConstraint b b_a_code_fkey", "changeColumn a code", "addConstraint b"]);
});

test("a new foreign key to a new table comes after that table, and a removed referenced table loses its keys first", async () => {
  const toNew = edit("  title text", "  tag_id integer [ref: > tags.id]\n  title text").concat("\nTable tags {\n  id integer [pk]\n}\n");
  assert.deepEqual((await run(generate(base, toNew).code, "up")).map(brief), [
    "createTable tags",
    "addColumn posts tag_id",
    "addConstraint posts",
  ]);

  const removedTarget = `Table users {\n  id integer [pk, increment]\n  email varchar(120) [not null, unique]\n  name varchar(50) [note: 'full name']\n  status enum('active', 'paused') [default: 'active']\n}\n`;
  const withoutPosts = generate(base, removedTarget, { allowDataLoss: true });
  assert.deepEqual((await run(withoutPosts.code, "up")).map(brief), [
    "removeConstraint posts posts_user_id_fkey",
    "removeIndex posts posts_title",
    "dropTable posts",
  ]);
});

test("every call runs in the transaction and no raw SQL is used", async () => {
  const after = edit("'active', 'paused'", "'active', 'closed'")
    .replace("delete: cascade", "delete: set null")
    .concat("\nTable tags {\n  id integer [pk]\n  kind enum('a')\n}\n");
  const { code } = generate(base, after, { allowDataLoss: true });

  assert.doesNotMatch(code, /sequelize\.query\(/);

  for (const step of ["up", "down"]) {
    for (const call of await run(code, step)) {
      assert.notEqual(call.method, "query");
      assert.equal(call.args[call.args.length - 1].transaction, "tx", `${step}: ${call.method}`);
    }
  }
});

test("the header names the DBML file and the snapshot", () => {
  const { code } = generate(base, edit("name varchar(50)", "name varchar(80)"), {
    source: "db.dbml",
    snapshotSource: "dbml2sequelize-snapshot.json",
  });

  assert.ok(
    code.includes(
      "/**\n * Generated by dbml2sequelize diff from db.dbml and dbml2sequelize-snapshot.json.\n" +
        " * Review it before applying it. Data is not moved or converted; add that by hand if needed.\n */\n"
    )
  );
});

test("the output is deterministic, and no changes give no code", () => {
  const after = edit("name varchar(50)", "name varchar(80)");
  assert.deepEqual(generate(base, after), generate(base, after));
  assert.equal(generate(base, after).snapshot, generateSnapshot(after));

  const none = generate(base, base);
  assert.equal(none.code, null);
  assert.equal(none.snapshot, null);
});

// File part

const date = new Date(Date.UTC(2026, 9, 17, 8, 30, 0));

test("writeDiffMigration writes the migration, then replaces the snapshot", () => {
  const { dir, file, snapshotPath } = writeSnapshotTemp(base);
  const after = edit("name varchar(50)", "name varchar(80)");
  fs.writeFileSync(file, after);

  const written = writeDiffMigration(file, { outDir: path.join(dir, "migrations"), date });

  assert.equal(written, path.join(dir, "migrations", "20261017083000-schema-update.js"));
  assert.match(fs.readFileSync(written, "utf8"), /from db\.dbml and dbml2sequelize-snapshot\.json/);
  assert.equal(fs.readFileSync(snapshotPath, "utf8"), generateSnapshot(after, { source: "db.dbml" }));
});

test("writeDiffMigration writes nothing when there are no changes", () => {
  const { dir, file, snapshotPath } = writeSnapshotTemp(base);
  const snapshot = fs.readFileSync(snapshotPath, "utf8");

  assert.equal(writeDiffMigration(file, { outDir: path.join(dir, "migrations"), date }), null);
  assert.deepEqual(fs.readdirSync(path.join(dir, "migrations")), ["dbml2sequelize-snapshot.json"]);
  assert.equal(fs.readFileSync(snapshotPath, "utf8"), snapshot);
});

test("writeDiffMigration without a snapshot throws and writes nothing", () => {
  const { dir, file } = writeSnapshotTemp(base);
  fs.rmSync(path.join(dir, "migrations"), { recursive: true });

  assert.throws(
    () => writeDiffMigration(file, { outDir: path.join(dir, "migrations") }),
    (error) => error instanceof SnapshotError && error.reason == "missing"
  );
  assert.equal(fs.existsSync(path.join(dir, "migrations")), false);
});

test("writeDiffMigration writes nothing on DBML errors or unsupported changes", () => {
  for (const after of [edit("title text", "title money"), edit(" [note: 'full name']", "")]) {
    const { dir, file, snapshotPath } = writeSnapshotTemp(base);
    const snapshot = fs.readFileSync(snapshotPath, "utf8");
    fs.writeFileSync(file, after);

    assert.throws(() => writeDiffMigration(file, { outDir: path.join(dir, "migrations") }), DbmlError);
    assert.deepEqual(fs.readdirSync(path.join(dir, "migrations")), ["dbml2sequelize-snapshot.json"]);
    assert.equal(fs.readFileSync(snapshotPath, "utf8"), snapshot);
  }
});

test("writeDiffMigration removes the migration again when the snapshot cannot be written", () => {
  const { dir, file, snapshotPath } = writeSnapshotTemp(base);
  const outDir = path.join(dir, "out");
  fs.writeFileSync(file, edit("name varchar(50)", "name varchar(80)"));
  fs.chmodSync(snapshotPath, 0o444); // readable, not writable

  try {
    assert.throws(() => writeDiffMigration(file, { outDir, snapshotPath, date }));
  } finally {
    fs.chmodSync(snapshotPath, 0o644);
  }

  assert.deepEqual(fs.readdirSync(outDir), []);
});

// Rollback (US5): down undoes up, in reverse order, from the snapshot's definitions

const everyBefore = `Table users {
  id integer [pk, increment]
  email varchar(120) [unique]
  name varchar(50) [note: 'full name']
  status enum('a', 'b') [default: 'a']
  old_col text
}

Table posts {
  id integer [pk, increment]
  user_id integer [ref: > users.id, delete: cascade]
  title text

  indexes {
    title
  }
}

Table legacy {
  id integer [pk]
  kind enum('x')
}
`;

const everyAfter = `Table people [renamed_from: 'users'] {
  id integer [pk, increment]
  email varchar(120)
  name varchar(80) [note: 'display name']
  status enum('a', 'b', 'c') [default: 'a']
  phone varchar(20) [unique]
}

Table posts {
  id integer [pk, increment]
  user_id integer [ref: > people.id, delete: set null]
  title text

  indexes {
    title [unique]
  }
}

Table tags {
  id integer [pk]
}
`;

test("down undoes every kind of change in reverse order", async () => {
  const { code } = generateDiffMigration(generateSnapshot(everyBefore), everyAfter, { allowDataLoss: true });
  const down = await run(code, "down");
  const at = (label) => {
    const position = down.findIndex((call) => brief(call) == label);
    assert.ok(position > -1, `${label} not in ${down.map(brief).join(", ")}`);
    return position;
  };
  const callAt = (label) => down[at(label)];

  // additions of up are undone first
  assert.ok(at("removeIndex posts posts_title") < at("removeColumn people phone"));
  assert.ok(at("removeColumn people phone") < at("dropTable tags"));

  // the changed column gets its previous definition, the note its previous text
  const name = down.find((call) => call.method == "changeColumn" && call.args[1] == "name");
  assert.deepEqual(typeOf(name.args[2]), { type: "STRING", args: [50] });
  assert.equal(name.args[2].comment, "full name");

  // the enum goes back to its old values, rebuilt under the current name
  const status = down.filter((call) => call.method == "changeColumn" && call.args[1] == "status");
  assert.deepEqual(typeOf(status[status.length - 1].args[2]), { type: "ENUM", args: ["a", "b"] });
  assert.ok(at("dropEnum enum_people_status") > -1);

  // the dropped table and the removed column come back from the snapshot, before the rename is reversed
  const legacy = callAt("createTable legacy");
  assert.equal(legacy.args[1].kind.type.type, "ENUM");
  assert.ok(at("addColumn people old_col") < at("renameTable people users"));
  assert.ok(at("dropTable tags") < at("createTable legacy"));

  // derived names and replaced keys come back last, under the snapshot's names
  const restored = down
    .slice(at("renameTable people users"))
    .filter((call) => call.method == "addConstraint" || call.method == "addIndex")
    .map((call) => (call.method == "addIndex" ? call.args[2].name : call.args[1].name));
  assert.deepEqual(restored, ["users_pkey", "users_email_key", "posts_title", "posts_user_id_fkey"]);
  assert.equal(down[down.length - 1].args[1].onDelete, "CASCADE");
});

test("every up step has its inverse in down", async () => {
  const { code } = generateDiffMigration(generateSnapshot(everyBefore), everyAfter, { allowDataLoss: true });
  const up = (await run(code, "up")).map(brief);
  const down = (await run(code, "down")).map(brief);
  const count = (calls, method) => calls.filter((call) => call.startsWith(`${method} `)).length;

  assert.equal(count(down, "addConstraint"), count(up, "removeConstraint"));
  assert.equal(count(down, "removeConstraint"), count(up, "addConstraint"));
  assert.equal(count(down, "addIndex"), count(up, "removeIndex"));
  assert.equal(count(down, "removeIndex"), count(up, "addIndex"));
  assert.equal(count(down, "renameTable"), count(up, "renameTable"));
  assert.equal(count(down, "createTable"), count(up, "dropTable"));
  assert.equal(count(down, "dropTable"), count(up, "createTable"));
  assert.equal(count(down, "addColumn"), count(up, "removeColumn"));
  assert.equal(count(down, "removeColumn"), count(up, "addColumn"));
});
