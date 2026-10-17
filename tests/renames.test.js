const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseSchema,
  generateMigration,
  generateSnapshot,
  generateDiffMigration,
  DbmlError,
} = require("../src");
const toModelAttributes = require("../src/converter/to-model-attributes");
const { fakeQueryInterface, loadMigration, FakeSequelize } = require("./helpers");

const base = `Table users {
  id integer [pk, increment]
  email varchar(120) [unique]
  fullname varchar(50)
  status enum('active', 'paused')

  indexes {
    fullname
    email [name: 'by_email']
  }
}

Table posts {
  id integer [pk, increment]
  user_id integer [ref: > users.id, delete: cascade]
}
`;

const generate = (after, before = base) => generateDiffMigration(generateSnapshot(before), after);

async function run(code, step) {
  const queryInterface = fakeQueryInterface();
  await loadMigration(code)[step](queryInterface, FakeSequelize);
  return queryInterface.calls;
}

const brief = (call) =>
  [call.method, ...call.args.slice(0, 3).filter((arg) => typeof arg == "string")].join(" ");

function errorOf(after, before = base) {
  try {
    generate(after, before);
  } catch (error) {
    assert.ok(error instanceof DbmlError, error.message);
    return error;
  }
  assert.fail("expected a DbmlError");
}

// Parsing

test("renamed_from is read on tables and columns", () => {
  const schema = parseSchema(`Table people [renamed_from: 'users'] {\n  id integer [pk]\n  full_name text [renamed_from: 'fullname']\n}\n`);
  assert.equal(schema.tables[0].renamedFrom, "users");
  assert.equal(schema.tables[0].columns[1].renamedFrom, "fullname");
});

test("an empty renamed_from is an error naming the table or column", () => {
  assert.throws(
    () => parseSchema(`Table people [renamed_from: ''] {\n  id integer [pk]\n  name text [renamed_from: '']\n}\n`),
    (error) =>
      error instanceof DbmlError &&
      /line 1: people: renamed_from needs the previous name/.test(error.message) &&
      /line 3: people\.name: renamed_from needs the previous name/.test(error.message)
  );
});

test("the initial migration, the snapshot and the models API ignore renamed_from", () => {
  const plain = `Table people {\n  id integer [pk]\n  full_name text\n}\n`;
  const renamed = `Table people [renamed_from: 'users'] {\n  id integer [pk]\n  full_name text [renamed_from: 'fullname']\n}\n`;

  assert.equal(generateMigration(renamed), generateMigration(plain));
  assert.equal(generateSnapshot(renamed), generateSnapshot(plain));
  assert.doesNotMatch(generateSnapshot(renamed), /renamedFrom/);

  const [table] = parseSchema(renamed).tables;
  const attributes = toModelAttributes(table, [], { fn: () => {}, literal: () => {} }, FakeSequelize);
  assert.equal("renamedFrom" in attributes.full_name, false);
});

// Matching

test("a renamed column becomes renameColumn, with no remove or add", async () => {
  const after = base.replace("fullname varchar(50)", "full_name varchar(50) [renamed_from: 'fullname']").replace("    fullname\n", "    full_name\n");
  const calls = await run(generate(after).code, "up");

  assert.ok(calls.some((call) => brief(call) == "renameColumn users fullname full_name"));
  assert.equal(calls.some((call) => call.method == "removeColumn" || call.method == "addColumn"), false);
});

test("a renamed column that also widens is renamed first, then changed", async () => {
  const after = base.replace("fullname varchar(50)", "full_name varchar(80) [renamed_from: 'fullname']").replace("    fullname\n", "    full_name\n");
  const methods = (await run(generate(after).code, "up")).map(brief);

  assert.ok(methods.indexOf("renameColumn users fullname full_name") < methods.indexOf("changeColumn users full_name"));
});

test("renamed_from is ignored once the snapshot has the new name", () => {
  const renamed = base.replace("fullname varchar(50)", "full_name varchar(50) [renamed_from: 'fullname']").replace("    fullname\n", "    full_name\n");
  assert.equal(generate(renamed, renamed).code, null);
});

test("renamed_from problems are reported together", () => {
  const after = base
    .replace("Table posts {", "Table articles [renamed_from: 'missing'] {")
    .replace("fullname varchar(50)", "fullname varchar(50)\n  nickname text [renamed_from: 'fullname']\n  alias text [renamed_from: 'fullname']");
  const error = errorOf(after);

  assert.match(error.message, /articles: renamed_from 'missing' matches no table in the snapshot/);
  assert.match(error.message, /users\.nickname: renamed_from 'fullname' names column 'fullname', which is still declared/);
  assert.match(error.message, /users\.alias: renamed_from 'fullname' is also claimed by column 'nickname'/);
});

// Derived names (FR-028a, research R4)

test("a renamed table renames and re-adds its derived constraints and indexes", async () => {
  const after = base.replace("Table users {", "Table people [renamed_from: 'users'] {").replace("ref: > users.id", "ref: > people.id");
  const { code } = generate(after);
  const up = (await run(code, "up")).map(brief);

  assert.deepEqual(up, [
    "removeConstraint posts posts_user_id_fkey",
    "removeIndex users users_fullname",
    "removeConstraint users users_email_key",
    "removeConstraint users users_pkey",
    "renameTable users people",
    "changeColumn people status",
    "dropEnum enum_users_status",
    "changeColumn people status",
    "addConstraint people",
    "addConstraint people",
    "addConstraint posts",
    "addIndex people",
  ]);

  const calls = await run(code, "up");
  const added = calls.filter((call) => call.method == "addConstraint").map((call) => call.args[1].name);
  assert.deepEqual(added, ["people_pkey", "people_email_key", "posts_user_id_fkey"]);
  assert.equal(calls.find((call) => call.method == "addIndex").args[2].name, "people_fullname");
  assert.equal(calls.some((call) => call.method == "removeIndex" && call.args[1] == "by_email"), false);
});

test("a renamed column with a foreign key and an enum type re-adds them under the new names", async () => {
  const before = `Table a {\n  id integer [pk]\n}\n\nTable b {\n  id integer [pk]\n  a_id integer [ref: > a.id]\n  kind enum('x', 'y')\n}\n`;
  const after = before
    .replace("a_id integer [ref: > a.id]", "owner_id integer [ref: > a.id, renamed_from: 'a_id']")
    .replace("kind enum('x', 'y')", "type enum('x', 'y') [renamed_from: 'kind']");
  const calls = await run(generate(after, before).code, "up");

  assert.deepEqual(calls.map(brief), [
    "removeConstraint b b_a_id_fkey",
    "renameColumn b a_id owner_id",
    "renameColumn b kind type",
    "changeColumn b type",
    "dropEnum enum_b_kind",
    "changeColumn b type",
    "addConstraint b",
  ]);
  assert.equal(calls[calls.length - 1].args[1].name, "b_owner_id_fkey");
});

test("down reverses a rename and its derived names in reverse order", async () => {
  const after = base.replace("Table users {", "Table people [renamed_from: 'users'] {").replace("ref: > users.id", "ref: > people.id");
  const { code } = generate(after);
  const up = (await run(code, "up")).map((call) => call.method);
  const down = (await run(code, "down")).map(brief);

  assert.equal(down.length, up.length);
  assert.deepEqual(down.slice(0, 4), [
    "removeIndex people people_fullname",
    "removeConstraint posts posts_user_id_fkey",
    "removeConstraint people people_email_key",
    "removeConstraint people people_pkey",
  ]);
  assert.ok(down.includes("dropEnum enum_people_status"));
  assert.ok(down.indexOf("renameTable people users") < down.indexOf("addIndex users"));
});
