const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSchema, DbmlError } = require("../src");
const diffSchema = require("../src/diff/diff-schema");
const { FOOTER } = require("../src/diff/unsupported-changes");
const { snapshotSchema } = require("../src/snapshot/create-snapshot");

const diff = (before, after) => diffSchema(snapshotSchema(parseSchema(before)), parseSchema(after));

const base = `Table users {
  id integer [pk, increment]
  email varchar(120)
  name varchar(50) [note: 'full name']
  age integer
}
`;

const MESSAGES = {
  noteAdded: "Adding a note to an existing column is not supported by Sequelize migrations",
  noteRemoved: "Removing a column note is not supported by Sequelize migrations",
  tableNote: "Changing a table note is not supported by Sequelize migrations",
  increment: "Changing an auto-increment column is not supported by Sequelize migrations",
};

function errorsOf(after, before = base) {
  try {
    diff(before, after);
  } catch (error) {
    assert.ok(error instanceof DbmlError, error.message);
    return error;
  }
  assert.fail("expected a DbmlError");
}

const cases = [
  ["a note added to a column that had none", base.replace("email varchar(120)", "email varchar(120) [note: 'login']"), "line 3: users.email", "noteAdded"],
  ["a column note removed", base.replace(" [note: 'full name']", ""), "line 4: users.name", "noteRemoved"],
  ["a table note added", base.replace("  age integer\n", "  age integer\n  Note: 'people'\n"), "line 1: users", "tableNote"],
  ["increment added", base.replace("age integer", "age integer [increment]"), "line 5: users.age", "increment"],
  ["increment removed", base.replace("id integer [pk, increment]", "id integer [pk]"), "line 2: users.id", "increment"],
  ["an auto-increment column whose type changes", base.replace("id integer [pk, increment]", "id bigint [pk, increment]"), "line 2: users.id", "increment"],
];

for (const [name, after, location, message] of cases) {
  test(`unsupported: ${name}`, () => {
    const error = errorsOf(after);
    assert.equal(error.errors.length, 1);
    assert.ok(error.message.startsWith(`${location}: ${MESSAGES[message]}`), error.message);
    assert.ok(error.message.endsWith(FOOTER));
  });
}

test("table notes changed or removed are unsupported", () => {
  const withNote = base.replace("  age integer\n", "  age integer\n  Note: 'people'\n");

  for (const after of [withNote.replace("'people'", "'persons'"), base]) {
    const error = errorsOf(after, withNote);
    assert.match(error.message, new RegExp(`users: ${MESSAGES.tableNote}`));
  }
});

test("every unsupported change is reported in one run, with the safe order at the end", () => {
  const after = base
    .replace("id integer [pk, increment]", "id integer [pk]")
    .replace("email varchar(120)", "email varchar(120) [note: 'login']")
    .replace(" [note: 'full name']", "");
  const error = errorsOf(after);

  assert.equal(error.errors.length, 3);
  assert.ok(error.message.endsWith(`\n\n${FOOTER}`));
  assert.match(FOOTER, /undo that edit[\s\S]*dbml2sequelize diff[\s\S]*redo the edit[\s\S]*by hand[\s\S]*dbml2sequelize baseline/);
});

test("notes on a new table or a new column are supported", () => {
  const after = `${base.replace("  age integer", "  age integer\n  nick text [note: 'short name']")}\nTable tags {\n  id integer [pk]\n  Note: 'labels'\n}\n`;
  assert.doesNotThrow(() => diff(base, after));
});
