const test = require("node:test");
const assert = require("node:assert/strict");
const { generateSnapshot, generateDiffMigration, DataLossError } = require("../src");
const { fakeQueryInterface, loadMigration, FakeSequelize } = require("./helpers");

const base = `Table users {
  id integer [pk, increment]
  code varchar(50)
  amount decimal(10,2)
  seen timestamp(3)
  size text('tiny')
  rank integer
  status enum('active', 'paused')
}

Table pairs {
  a integer [pk]
  b integer
}

Table logs {
  id integer [pk]
}
`;

const edit = (from, to, text = base) => text.replace(from, to);
const generate = (after, opts) => generateDiffMigration(generateSnapshot(base), after, opts);

function refused(after) {
  try {
    generate(after);
  } catch (error) {
    assert.ok(error instanceof DataLossError, error.message);
    return error;
  }
  assert.fail("expected a DataLossError");
}

const cases = [
  ["a removed table", base.replace("\nTable logs {\n  id integer [pk]\n}\n", ""), "logs", undefined, "table removed"],
  ["a removed column", edit("  rank integer\n", ""), "users", "rank", "column removed"],
  ["integer to bigint", edit("rank integer", "rank bigint"), "users", "rank", "type changes from INTEGER to BIGINT"],
  ["a length added", edit("code varchar(50)", "code varchar"), "users", "code", "type changes from STRING(50) to STRING"],
  ["a scale changed", edit("decimal(10,2)", "decimal(10,4)"), "users", "amount", "type changes from DECIMAL(10, 2) to DECIMAL(10, 4)"],
  ["a text size changed", edit("text('tiny')", "text('long')"), "users", "size", "type changes from TEXT('tiny') to TEXT('long')"],
  ["an enum value removed", edit("'active', 'paused'", "'active'"), "users", "status", "enum value 'paused' removed"],
  ["an enum value renamed", edit("'active', 'paused'", "'active', 'on_hold'"), "users", "status", "enum value 'paused' removed"],
  ["a primary key changed", edit("  a integer [pk]\n  b integer", "  a integer\n  b integer [pk]"), "pairs", undefined, "primary key changes from (a) to (b)"],
  ["a composite primary key added", edit("  a integer [pk]\n  b integer\n", "  a integer\n  b integer\n\n  indexes {\n    (a, b) [pk]\n  }\n"), "pairs", undefined, "primary key changes from (a) to (a, b)"],
  ["a primary key removed", edit("  a integer [pk]", "  a integer"), "pairs", undefined, "primary key changes from (a) to ()"],
];

for (const [name, after, table, column, message] of cases) {
  test(`data loss: ${name}`, () => {
    const error = refused(after);
    const change = error.changes.find((item) => item.table == table && item.column == column);

    assert.ok(change, JSON.stringify(error.changes));
    assert.ok(change.message.startsWith(message), change.message);
    assert.match(error.message, /^Refused: these changes can lose data \(pass --allow-data-loss to generate them\):\n/);
  });
}

test("widening a length or precision is not data loss", () => {
  for (const after of [
    edit("code varchar(50)", "code varchar(100)"),
    edit("decimal(10,2)", "decimal(12,2)"),
    edit("timestamp(3)", "timestamp(6)"),
  ]) {
    assert.ok(generate(after).code, after);
  }
});

test("removing keys, indexes, unique rules or defaults, nullability and enum additions are not data loss", () => {
  const rich = `Table a {\n  id integer [pk]\n  code varchar(10) [unique, default: 'x', not null]\n  status enum('a', 'b')\n\n  indexes {\n    code\n  }\n}\n\nTable b {\n  id integer [pk]\n  a_id integer [ref: > a.id]\n}\n`;
  const plain = `Table a {\n  id integer [pk]\n  code varchar(10)\n  status enum('b', 'a', 'c')\n}\n\nTable b {\n  id integer [pk]\n  a_id integer\n}\n`;

  assert.ok(generateDiffMigration(generateSnapshot(rich), plain).code);
});

test("every data-loss change is listed in one run, next to safe changes", () => {
  const after = edit("  rank integer\n", "").replace("rank bigint", "").replace("'active', 'paused'", "'active'").replace("code varchar(50)", "code varchar(100)");
  const error = refused(after);

  assert.deepEqual(
    error.changes.map((change) => [change.table, change.column].filter(Boolean).join(".")),
    ["users.rank", "users.status"]
  );
});

test("a removed and an added column suggest renamed_from", () => {
  const error = refused(edit("  rank integer", "  position integer"));
  assert.match(error.message, /users\.rank: column removed \(if it was renamed, add renamed_from: 'rank' to the new column\)/);
});

test("a removed and an added table suggest renamed_from", () => {
  const error = refused(edit("Table logs {", "Table events {"));
  assert.match(error.message, /logs: table removed \(if it was renamed, add renamed_from: 'logs' to the new table\)/);
});

test("with data loss allowed, the change is generated and down restores the column", async () => {
  const { code } = generate(edit("  rank integer\n", ""), { allowDataLoss: true });
  const queryInterface = fakeQueryInterface();
  await loadMigration(code).down(queryInterface, FakeSequelize);

  const [add] = queryInterface.calls;
  assert.equal(add.method, "addColumn");
  assert.deepEqual([add.args[0], add.args[1], add.args[2].type.type], ["users", "rank", "INTEGER"]);
});
