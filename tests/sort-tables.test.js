const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSchema } = require("../src");
const sortTables = require("../src/migration/sort-tables");

const names = ({ ordered }) => ordered.map((table) => table.name);

test("creates referenced tables first and keeps file order otherwise", () => {
  const schema = parseSchema(`Table kycs {
  id integer [pk]
  account_id integer [ref: > accounts.id]
}

Table notes {
  id integer [pk]
}

Table accounts {
  id integer [pk]
}`);

  assert.deepEqual(names(sortTables(schema)), ["notes", "accounts", "kycs"]);
});

test("self-references do not defer anything", () => {
  const schema = parseSchema(`Table accounts {
  id integer [pk]
  created_by integer [ref: > accounts.id]
}`);

  const result = sortTables(schema);
  assert.deepEqual(names(result), ["accounts"]);
  assert.deepEqual(result.deferred, []);
});

test("a two-table cycle defers exactly the closing foreign key", () => {
  const schema = parseSchema(`Table a {
  id integer [pk]
  b_id integer [ref: > b.id]
}

Table b {
  id integer [pk]
  a_id integer [ref: > a.id]
}`);

  const result = sortTables(schema);
  assert.deepEqual(names(result), ["a", "b"]);
  assert.deepEqual(result.deferred, [{ table: "a", column: "b_id" }]);
});
