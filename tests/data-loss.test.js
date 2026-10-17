const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSchema, generateMigration } = require("../src");

const dbml = `Table items {
  id integer [pk, increment]
  details jsonb [note: 'recurrence pattern']
  message text [note: 'notification message content', not null]
  status varchar(50) [note: 'active, paused, cancelled, etc.', default: 'active']
  is_active boolean [default: 1]
  is_read boolean [default: 0]

  //for essentials only

  ratio varchar(10) [note: 'ratio: 1:2'] // trailing comment
  link text [note: 'see https://x.io // not a comment {braces} [brackets]']

  Note: {
    'Things people pay for'
  }
}`;

const column = (name) => parseSchema(dbml).tables[0].columns.find((item) => item.name == name);

test("jsonb columns are kept", () => {
  assert.deepEqual(column("details").type, { name: "JSONB", args: [] });
  assert.match(generateMigration(dbml), /details: \{\n\s+type: Sequelize\.JSONB,/);
});

test("table Note blocks become the table comment", () => {
  assert.equal(parseSchema(dbml).tables[0].comment, "Things people pay for");
  assert.match(generateMigration(dbml), /comment: "Things people pay for", transaction/);
});

test("text columns keep all their settings", () => {
  assert.equal(column("message").comment, "notification message content");
  assert.equal(column("message").allowNull, false);
});

test("commas inside notes are kept", () => {
  assert.equal(column("status").comment, "active, paused, cancelled, etc.");
  assert.doesNotMatch(generateMigration(dbml), /\(comma\)/);
});

test("string defaults lose their quotes", () => {
  assert.deepEqual(column("status").defaultValue, { kind: "value", value: "active" });
  assert.match(generateMigration(dbml), /defaultValue: "active",/);
});

test("boolean defaults 1 and 0 become true and false", () => {
  assert.deepEqual(column("is_active").defaultValue, { kind: "value", value: true });
  assert.deepEqual(column("is_read").defaultValue, { kind: "value", value: false });
});

test("comment lines are ignored and never become columns", () => {
  const names = parseSchema(dbml).tables[0].columns.map((item) => item.name);
  assert.deepEqual(names, ["id", "details", "message", "status", "is_active", "is_read", "ratio", "link"]);
});

test("values containing colons are kept whole", () => {
  assert.equal(column("ratio").comment, "ratio: 1:2");
});

test("quoted //, braces and brackets are text, not syntax", () => {
  assert.equal(column("link").comment, "see https://x.io // not a comment {braces} [brackets]");
});
