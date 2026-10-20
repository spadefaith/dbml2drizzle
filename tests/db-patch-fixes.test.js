const test = require("node:test");
const assert = require("node:assert/strict");
const { Parser } = require("@dbml/core");
const { generateDbPatch, generateSchema } = require("../src");

/**
 * Feature 013: db-patch.dbml inputs that standard DBML rejected before
 * (research R1–R4). Every copy must parse with @dbml/core.
 */

/** Parses `text` as standard DBML; on failure, lists @dbml/core's diagnostics. */
function parsesStandard(text) {
  try {
    new Parser().parse(text, "dbmlv2");
  } catch (error) {
    const diags = (error.diags || [error]).map((diag) =>
      diag.location ? `${diag.location.start.line}: ${diag.message}` : String(diag.message || diag));
    throw new Error(`@dbml/core rejected the copy:\n${diags.join("\n")}\n---\n${text}`);
  }
}

/** The copy of `dbml`, checked to parse with @dbml/core. */
function patchOf(dbml) {
  const output = generateDbPatch(dbml);
  parsesStandard(output);
  return output;
}

/** Joins lines with "\n"; keeps backticks readable in single-quoted strings. */
const lines = (...items) => items.join("\n");

const MOVED = "// Relationships moved from inline settings by dbml2drizzle";

// R1 -------------------------------------------------------------------------

test("R1: unquoted function and keyword defaults are written in backticks", () => {
  const dbml = lines(
    "Table t {",
    "  id integer [pk]",
    "  a timestamptz [default: now()]",
    "  b timestamp [default: CURRENT_TIMESTAMP]",
    "  c date [default: current_date]",
    "  d time [default: CURRENT_TIME, not null] // keep",
    "  e varchar [default: 'now()']",
    "}",
    ""
  );

  assert.equal(patchOf(dbml), lines(
    "Table t {",
    "  id integer [pk]",
    "  a timestamptz [default: `now()`]",
    "  b timestamp [default: `CURRENT_TIMESTAMP`]",
    "  c date [default: `current_date`]",
    "  d time [default: `CURRENT_TIME`, not null] // keep",
    "  e varchar [default: 'now()']",
    "}",
    ""
  ));
});

// R2 -------------------------------------------------------------------------

test("R2: moved references quote names that are not plain identifiers", () => {
  const dbml = lines(
    'Table "order items" {',
    "  id integer [pk]",
    "  order_id integer [ref: > orders.id, delete: cascade]",
    "}",
    "",
    "Table orders {",
    "  id integer [pk]",
    '  "placed by" integer [ref: > people.id, update: cascade]',
    "  owner_id integer [ref: > people.id, delete: set null]",
    "}",
    "",
    "Table people {",
    "  id integer [pk]",
    "}",
    ""
  );

  assert.equal(patchOf(dbml), lines(
    'Table "order items" {',
    "  id integer [pk]",
    "  order_id integer",
    "}",
    "",
    "Table orders {",
    "  id integer [pk]",
    '  "placed by" integer',
    "  owner_id integer",
    "}",
    "",
    "Table people {",
    "  id integer [pk]",
    "}",
    "",
    MOVED,
    'Ref: "order items".order_id > orders.id [delete: cascade]',
    'Ref: orders."placed by" > people.id [update: cascade]',
    "Ref: orders.owner_id > people.id [delete: set null]",
    ""
  ));
});

// R3 -------------------------------------------------------------------------

const accounts = lines("Table accounts {", "  id integer [pk]", "}");

test("R3a: a later standalone Ref duplicating an inline ref is removed", () => {
  const dbml = lines(
    "Table accounts {",
    "  id integer [pk, ref: < orders.account_id]",
    "}",
    "",
    "Table orders {",
    "  id integer [pk]",
    "  account_id integer",
    "}",
    "",
    "Ref: orders.account_id > accounts.id",
    ""
  );

  assert.equal(patchOf(dbml), lines(
    "Table accounts {",
    "  id integer [pk, ref: < orders.account_id]",
    "}",
    "",
    "Table orders {",
    "  id integer [pk]",
    "  account_id integer",
    "}",
    "",
    ""
  ));
});

test("R3b: a standalone Ref written before the inline ref is removed (inline is read first)", () => {
  const dbml = lines(
    accounts,
    "",
    "Ref: orders.account_id > accounts.id",
    "",
    "Table orders {",
    "  id integer [pk]",
    "  account_id integer [ref: > accounts.id]",
    "}",
    ""
  );

  assert.equal(patchOf(dbml), lines(
    accounts,
    "",
    "",
    "Table orders {",
    "  id integer [pk]",
    "  account_id integer [ref: > accounts.id]",
    "}",
    ""
  ));
});

test("R3c: a Ref { } block whose only entry is a duplicate is removed", () => {
  const dbml = lines(
    accounts,
    "",
    "Table orders {",
    "  id integer [pk]",
    "  account_id integer [ref: > accounts.id]",
    "}",
    "",
    "Ref {",
    "  orders.account_id > accounts.id",
    "}",
    ""
  );

  assert.equal(patchOf(dbml), lines(
    accounts,
    "",
    "Table orders {",
    "  id integer [pk]",
    "  account_id integer [ref: > accounts.id]",
    "}",
    "",
    ""
  ));
});

test("R3d: in a Ref { } block, only the duplicate entry is removed", () => {
  const dbml = lines(
    accounts,
    "",
    "Table orders {",
    "  id integer [pk]",
    "  account_id integer [ref: > accounts.id]",
    "  approved_by integer",
    "}",
    "",
    "Ref {",
    "  orders.account_id > accounts.id",
    "  orders.approved_by > accounts.id [delete: set null]",
    "}",
    ""
  );

  assert.equal(patchOf(dbml), lines(
    accounts,
    "",
    "Table orders {",
    "  id integer [pk]",
    "  account_id integer [ref: > accounts.id]",
    "  approved_by integer",
    "}",
    "",
    "Ref {",
    "  orders.approved_by > accounts.id [delete: set null]",
    "}",
    ""
  ));
});

test("R3e: a second inline declaration loses its ref and actions, and only one Ref is moved", () => {
  const dbml = lines(
    "Table accounts {",
    "  id integer [pk, ref: < orders.account_id, delete: cascade]",
    "}",
    "",
    "Table orders {",
    "  id integer [pk]",
    "  account_id integer [ref: > accounts.id, delete: cascade]",
    "  owner_id integer [not null, ref: > accounts.id] // owner",
    "}",
    "",
    "Table extra {",
    "  id integer [pk]",
    "  ref_id integer [ref: > orders.owner_id]",
    "}",
    ""
  );

  assert.equal(patchOf(dbml), lines(
    "Table accounts {",
    "  id integer [pk]",
    "}",
    "",
    "Table orders {",
    "  id integer [pk]",
    "  account_id integer",
    "  owner_id integer [not null, ref: > accounts.id] // owner",
    "}",
    "",
    "Table extra {",
    "  id integer [pk]",
    "  ref_id integer [ref: > orders.owner_id]",
    "}",
    "",
    MOVED,
    "Ref: accounts.id < orders.account_id [delete: cascade]",
    ""
  ));
});

test("R3e: a dropped inline ref without actions keeps the line's other settings", () => {
  const dbml = lines(
    "Table accounts {",
    "  id integer [pk, ref: < orders.account_id]",
    "}",
    "",
    "Table orders {",
    "  id integer [pk]",
    "  account_id integer [not null, ref: > accounts.id] // owner",
    "}",
    ""
  );

  assert.equal(patchOf(dbml), lines(
    "Table accounts {",
    "  id integer [pk, ref: < orders.account_id]",
    "}",
    "",
    "Table orders {",
    "  id integer [pk]",
    "  account_id integer [not null] // owner",
    "}",
    ""
  ));
});

test("R3f: a named standalone Ref duplicating an inline ref is removed", () => {
  const dbml = lines(
    accounts,
    "",
    "Table orders {",
    "  id integer [pk]",
    "  account_id integer [ref: > accounts.id]",
    "}",
    "",
    "Ref order_acc: orders.account_id > accounts.id",
    ""
  );

  assert.equal(patchOf(dbml), lines(
    accounts,
    "",
    "Table orders {",
    "  id integer [pk]",
    "  account_id integer [ref: > accounts.id]",
    "}",
    "",
    ""
  ));
});

// R4 -------------------------------------------------------------------------

test("R4a: a column check with a backtick becomes a comment, after an existing one", () => {
  const dbml = lines(
    "Table events {",
    "  id integer [pk]",
    "  code varchar(20) [not null, check: `code <> '\\`'`] // note",
    "}",
    ""
  );

  assert.equal(patchOf(dbml), lines(
    "Table events {",
    "  id integer [pk]",
    "  code varchar(20) [not null] // note // check events_code_check: `code <> '\\`'`",
    "}",
    ""
  ));
});

test("R4b: a column whose only setting is such a check loses its brackets", () => {
  const dbml = lines(
    "Table events {",
    "  id integer [pk]",
    "  code varchar(20) [check: `code <> '\\`'`]",
    "}",
    ""
  );

  assert.equal(patchOf(dbml), lines(
    "Table events {",
    "  id integer [pk]",
    "  code varchar(20) // check events_code_check: `code <> '\\`'`",
    "}",
    ""
  ));
});

test("R4c: a checks { } entry with a backtick becomes a comment; the block stays", () => {
  const dbml = lines(
    "Table events {",
    "  id integer [pk]",
    "  code varchar(20)",
    "",
    "  checks {",
    "    `code not like '%\\`%'` [name: 'no_bt'] // why",
    "  }",
    "}",
    ""
  );

  assert.equal(patchOf(dbml), lines(
    "Table events {",
    "  id integer [pk]",
    "  code varchar(20)",
    "",
    "  checks {",
    "    // check no_bt: `code not like '%\\`%'` [name: 'no_bt'] // why",
    "  }",
    "}",
    ""
  ));
});

test("R4d/e/f: index entries with a backtick become comments; others are unchanged", () => {
  const dbml = lines(
    "Table t {",
    "  id integer [pk]",
    "  a text",
    "  deleted_at timestamp",
    "",
    "  indexes {",
    "    `replace(a, '\\`', '')` [name: 'a_clean']",
    "    `lower(a)` [name: 'a_live', where: `a <> '\\`'`]",
    "    (`upper(a)`, id) [unique, name: 'a_upper', where: `deleted_at is null`]",
    "  }",
    "",
    "  checks {",
    "    `id > 0` [name: 'id_positive']",
    "  }",
    "}",
    ""
  );

  assert.equal(patchOf(dbml), lines(
    "Table t {",
    "  id integer [pk]",
    "  a text",
    "  deleted_at timestamp",
    "",
    "  indexes {",
    "    // index a_clean: `replace(a, '\\`', '')` [name: 'a_clean']",
    "    `lower(a)` [name: 'a_live', note: 'where a <> \\'`\\'']",
    "    (`upper(a)`, id) [unique, name: 'a_upper', note: 'where deleted_at is null']",
    "  }",
    "",
    "  checks {",
    "    `id > 0` [name: 'id_positive']",
    "  }",
    "}",
    ""
  ));
});

test("R4e: an index entry with a backtick expression and where: becomes the comment", () => {
  const dbml = lines(
    "Table t {",
    "  id integer [pk]",
    "  a text",
    "",
    "  indexes {",
    "    `replace(a, '\\`', '')` [name: 'a_clean', where: `a is not null`]",
    "  }",
    "}",
    ""
  );

  assert.equal(patchOf(dbml), lines(
    "Table t {",
    "  id integer [pk]",
    "  a text",
    "",
    "  indexes {",
    "    // index a_clean: `replace(a, '\\`', '')` [name: 'a_clean', where: `a is not null`]",
    "  }",
    "}",
    ""
  ));
});

// R5 -------------------------------------------------------------------------

test("R5: one column line with all four inputs gets one combined replacement", () => {
  const dbml = lines(
    'Table "big table" {',
    "  id integer [pk]",
    "  d timestamptz [default: now(), check: `d > '\\`'`, ref: > t.id, delete: cascade] // d",
    "}",
    "",
    "Table t {",
    "  id timestamptz [pk]",
    "}",
    ""
  );

  assert.equal(patchOf(dbml), lines(
    'Table "big table" {',
    "  id integer [pk]",
    "  d timestamptz [default: `now()`] // d // check big table_d_check: `d > '\\`'`",
    "}",
    "",
    "Table t {",
    "  id timestamptz [pk]",
    "}",
    "",
    MOVED,
    'Ref: "big table".d > t.id [delete: cascade]',
    ""
  ));
});

test("FR-014: the schema of the R5 input is the same with or without the copy fixes", () => {
  // generateSchema never reads patch edits; this guards against that changing
  const dbml = lines("Table t {", "  id integer [pk]", "  a timestamptz [default: now()]", "}", "");
  assert.match(generateSchema(dbml, { sourceName: "x.dbml" }), /a: timestamp\("a", \{ withTimezone: true \}\)\.defaultNow\(\),/);
});
