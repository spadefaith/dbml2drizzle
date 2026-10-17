const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSchema } = require("../src");
const diffSchema = require("../src/diff/diff-schema");
const { snapshotSchema } = require("../src/snapshot/create-snapshot");

const diff = (before, after) => diffSchema(snapshotSchema(parseSchema(before)), parseSchema(after));

const label = (change) => {
  if (change.index) return `${change.kind} ${change.index.name}`;
  if (change.name) return `${change.kind} ${change.name}`;
  return `${change.kind} ${[change.table, change.column].filter(Boolean).join(".")}`;
};
const labels = (before, after) => diff(before, after).changes.map(label);

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

const edit = (from, to) => base.replace(from, to);

test("identical schemas give an empty change set", () => {
  const set = diff(base, base);
  assert.equal(set.empty, true);
  assert.deepEqual(set.changes, []);
});

test("column order is not a schema change", () => {
  const reordered = edit(
    "  email varchar(120) [not null, unique]\n  name varchar(50) [note: 'full name']",
    "  name varchar(50) [note: 'full name']\n  email varchar(120) [not null, unique]"
  );
  assert.equal(diff(base, reordered).empty, true);
});

test("a new table is one createTable change, including its own foreign keys", () => {
  const after = `${base}\nTable tags {\n  id integer [pk]\n  post_id integer [ref: > posts.id]\n}\n`;
  assert.deepEqual(labels(base, after), ["createTable tags"]);
});

test("a removed table removes its foreign keys and indexes first", () => {
  const after = base.slice(0, base.indexOf("Table posts"));
  assert.deepEqual(labels(base, after), [
    "removeForeignKey posts_user_id_fkey",
    "removeIndex posts_title",
    "dropTable posts",
  ]);
});

test("added and removed columns", () => {
  assert.deepEqual(labels(base, edit("  name varchar(50)", "  phone varchar(20)\n  name varchar(50)")), [
    "addColumn users.phone",
  ]);
  assert.deepEqual(labels(base, edit("  title text\n\n  indexes {\n    title\n  }\n", "")), [
    "removeIndex posts_title",
    "removeColumn posts.title",
  ]);
});

test("a changed column lists exactly the fields that changed", () => {
  const after = edit(
    "name varchar(50) [note: 'full name']",
    "name varchar(80) [not null, default: 'x', note: 'display name']"
  );
  const [change] = diff(base, after).changes;

  assert.equal(label(change), "changeColumn users.name");
  assert.deepEqual(change.fields, ["type", "allowNull", "defaultValue", "comment"]);
  assert.equal(change.enumRebuild, false);
});

test("unique rules are removed and added by their derived names", () => {
  const after = edit("email varchar(120) [not null, unique]", "email varchar(120) [not null]").replace(
    "name varchar(50) [note: 'full name']",
    "name varchar(50) [unique, note: 'full name']"
  );
  assert.deepEqual(labels(base, after), ["removeUnique users_email_key", "addUnique users_name_key"]);
});

test("enum values added or reordered rebuild the enum type", () => {
  for (const values of ["'active', 'paused', 'closed'", "'paused', 'active'"]) {
    const [change] = diff(base, edit("'active', 'paused'", values)).changes;
    assert.equal(label(change), "changeColumn users.status");
    assert.deepEqual(change.fields, ["type"]);
    assert.equal(change.enumRebuild, true);
  }
});

test("a primary key change, including a composite one", () => {
  const before = `Table pairs {\n  a integer [pk]\n  b integer\n}\n`;
  const after = `Table pairs {\n  a integer\n  b integer\n\n  indexes {\n    (a, b) [pk]\n  }\n}\n`;
  const set = diff(before, after);

  assert.deepEqual(set.changes.map(label), ["changePrimaryKey pairs", "changeColumn pairs.b"]);
  assert.deepEqual(set.changes[0].before, ["a"]);
  assert.deepEqual(set.changes[0].after, ["a", "b"]);
  assert.deepEqual(set.changes[1].fields, ["allowNull"]);
});

test("indexes added, removed and changed", () => {
  assert.deepEqual(labels(base, edit("    title\n", "    title [unique]\n")), [
    "removeIndex posts_title",
    "addIndex posts_title",
  ]);
  assert.deepEqual(labels(base, edit("    title\n", "    title\n    (user_id, title)\n")), [
    "addIndex posts_user_id_title",
  ]);
  assert.deepEqual(labels(base, edit("    title\n", "    title [type: hash]\n")), [
    "removeIndex posts_title",
    "addIndex posts_title",
  ]);
});

test("foreign keys added, removed and changed", () => {
  assert.deepEqual(labels(base, edit("delete: cascade", "delete: set null")), [
    "removeForeignKey posts_user_id_fkey",
    "addForeignKey posts_user_id_fkey",
  ]);
  assert.deepEqual(labels(base, edit("user_id integer [ref: > users.id, delete: cascade]", "user_id integer")), [
    "removeForeignKey posts_user_id_fkey",
  ]);
  assert.deepEqual(labels(base, edit("  title text", "  editor_id integer [ref: > users.id]\n  title text")), [
    "addColumn posts.editor_id",
    "addForeignKey posts_editor_id_fkey",
  ]);
});

test("composite foreign keys are added by their derived name", () => {
  const tables = `Table products {\n  shop_id integer\n  code varchar(10)\n\n  indexes {\n    (shop_id, code) [pk]\n  }\n}\n\nTable lines {\n  id integer [pk]\n  shop_id integer\n  code varchar(10)\n}\n`;
  const after = `${tables}\nRef: lines.(shop_id, code) > products.(shop_id, code)\n`;
  assert.deepEqual(labels(tables, after), ["addForeignKey lines_shop_id_code_fkey"]);
});

test("turning a reference into one-to-one adds the unique rule", () => {
  assert.deepEqual(labels(base, edit("[ref: > users.id, delete: cascade]", "[ref: - users.id, delete: cascade]")), [
    "addUnique posts_user_id_key",
  ]);
});

test("a type change on a referenced column removes and re-adds the foreign key around it", () => {
  const before = `Table a {\n  code varchar(10) [pk]\n}\n\nTable b {\n  id integer [pk]\n  a_code varchar(10) [ref: > a.code]\n}\n`;
  const after = before.replace("code varchar(10) [pk]", "code varchar(20) [pk]");
  assert.deepEqual(labels(before, after), [
    "removeForeignKey b_a_code_fkey",
    "changeColumn a.code",
    "addForeignKey b_a_code_fkey",
  ]);
});
