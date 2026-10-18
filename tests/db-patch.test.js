const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { Parser } = require("@dbml/core");
const { parseSchema, generateDbPatch, writeDbPatch, writeSchema } = require("../src");
const { writeTemp } = require("./helpers");

const dbml = `Project shop {
  database_type: 'postgres'
  Note: 'Shop schema'
}

// accounts and who changed them
Table accounts {
  id integer [primary key, not null, increment]
  created_by integer [ref: > accounts.id, delete:set null]
  status enum('active','closed') [default: 'active']
  bio text('long')
  born dateonly
  details jsonb
}

Table orders {
  id integer [pk]
  account_id integer [ref: > accounts.id, delete:cascade, not null, note: 'owner, required'] // who ordered
  approved_by integer [ref: > accounts.id]
  updated_by integer [ref: > accounts.id, update: cascade]

  Note: {
    'Orders placed by accounts'
  }
}

Table invoices {
  id integer [pk, ref: < payments.invoice_id, delete: restrict]
}

Table payments {
  id integer [pk]
  invoice_id integer
}

TableGroup billing {
  orders
  invoices
}
`;

const parseStandard = (text) => new Parser().parse(text, "dbmlv2");

function standardRefs(database) {
  return database.schemas[0].refs
    .map((ref) => {
      const many = ref.endpoints.find((endpoint) => endpoint.relation == "*");
      const one = ref.endpoints.find((endpoint) => endpoint.relation == "1");
      return `${many.tableName}.${many.fieldNames[0]}->${one.tableName}.${one.fieldNames[0]}` +
        ` delete=${ref.onDelete || ""} update=${ref.onUpdate || ""}`;
    })
    .sort();
}

test("the source itself is rejected by the standard parser (sanity check)", () => {
  assert.throws(() => parseStandard(dbml));
});

test("the generated file parses with the standard DBML parser", () => {
  assert.doesNotThrow(() => parseStandard(generateDbPatch(dbml)));
});

test("every relationship keeps its direction and actions", () => {
  const refs = standardRefs(parseStandard(generateDbPatch(dbml)));

  assert.deepEqual(refs, [
    "accounts.created_by->accounts.id delete=set null update=",
    "orders.account_id->accounts.id delete=cascade update=",
    "orders.approved_by->accounts.id delete= update=",
    "orders.updated_by->accounts.id delete= update=cascade",
    "payments.invoice_id->invoices.id delete=restrict update=",
  ]);
  assert.equal(refs.length, parseSchema(dbml).relationships.length);
});

test("moved columns keep their other settings and trailing comment", () => {
  const patch = generateDbPatch(dbml);

  assert.match(patch, /^  account_id integer \[not null, note: 'owner, required'\] \/\/ who ordered$/m);
  assert.match(patch, /^  created_by integer$/m);
  assert.match(patch, /^  id integer \[pk\]$/m);
  assert.match(patch, /^Ref: orders\.account_id > accounts\.id \[delete: cascade\]$/m);
  assert.match(patch, /^Ref: invoices\.id < payments\.invoice_id \[delete: restrict\]$/m);
});

test("lines that need no rewrite are copied unchanged", () => {
  const patch = generateDbPatch(dbml).split("\n");
  // created_by, account_id, updated_by, the orders Note block, invoices.id
  const changed = new Set([9, 18, 20, 22, 28]);

  dbml.split("\n").forEach((line, index) => {
    changed.has(index + 1) || assert.equal(patch[index], line, `line ${index + 1}`);
  });
});

test("Note: { becomes Note {", () => {
  const patch = generateDbPatch(dbml);
  assert.match(patch, /^  Note \{$/m);
  assert.doesNotMatch(patch, /Note: \{/);
});

test("output is deterministic", () => {
  assert.equal(generateDbPatch(dbml), generateDbPatch(dbml));
});

test("writeDbPatch writes <base>-patch.dbml next to the source by default", () => {
  const { dir, file } = writeTemp("db.dbml", dbml);
  const before = fs.readFileSync(file);

  const written = writeDbPatch(file);

  assert.equal(written, path.join(dir, "db-patch.dbml"));
  assert.equal(fs.readFileSync(written, "utf8"), generateDbPatch(dbml));
  assert.deepEqual(fs.readFileSync(file), before);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["db-patch.dbml", "db.dbml"]);
});

test("writeDbPatch honours outPath and replaces an existing file", () => {
  const { dir, file } = writeTemp("db.dbml", dbml);
  const outPath = path.join(dir, "docs", "schema.dbml");
  fs.mkdirSync(path.dirname(outPath));
  fs.writeFileSync(outPath, "old content");

  assert.equal(writeDbPatch(file, { outPath }), outPath);
  assert.equal(fs.readFileSync(outPath, "utf8"), generateDbPatch(dbml));
});

test("writeSchema never writes db-patch.dbml", () => {
  const { dir, file } = writeTemp("db.dbml", dbml);
  writeSchema(file);

  assert.deepEqual(fs.readdirSync(dir).sort(), ["db.dbml", "db.schema.ts"]);
});

test("checks are kept unchanged and the standard parser reads them", () => {
  const source = `Table events {
  id integer [pk]
  starts_at timestamptz [not null]
  ends_at timestamptz [not null]
  seats integer [check: \`seats > 0\`]

  checks {
    \`ends_at > starts_at\` [name: 'events_valid_range']
  }
}
`;
  const output = generateDbPatch(source);
  const table = new Parser().parse(output, "dbmlv2").schemas[0].tables[0];

  assert.equal(output, source);
  assert.equal(table.fields.find((field) => field.name == "seats").checks[0].expression, "seats > 0");
  assert.equal(table.checks[0].name, "events_valid_range");
  assert.equal(table.checks[0].expression, "ends_at > starts_at");
});

test("partial indexes keep their condition in the note; expression indexes are copied", () => {
  const source = `Table users {
  id integer [pk]
  email varchar(255) [not null]
  deleted_at timestamptz
  prefs jsonb
  name text

  indexes {
    \`lower(email)\` [unique, name: 'users_email_ci']
    email [unique, where: \`deleted_at is null\`, note: 'active users']
    \`(prefs -> 'tags')\` [type: gin, name: 'users_tags', where: \`prefs is not null\`] // tags
    name [where: \`name <> 'x'\`]
  }
}
`;
  const output = generateDbPatch(source);
  const expected = source
    .replace("email [unique, where: `deleted_at is null`, note: 'active users']", "email [unique, note: 'active users (where deleted_at is null)']")
    .replace("[type: gin, name: 'users_tags', where: `prefs is not null`] // tags", "[type: gin, name: 'users_tags', note: 'where prefs is not null'] // tags")
    .replace("name [where: `name <> 'x'`]", "name [note: 'where name <> \\'x\\'']");

  assert.equal(output, expected);
  assert.doesNotThrow(() => new Parser().parse(output, "dbmlv2"));
});

test("an Enum's note moves onto its first value, since standard DBML rejects it", () => {
  const source = `Table orders {
  id integer [pk]
  status order_status [not null, default: 'new']
  kind kind
}

Enum order_status {
  Note: 'Lifecycle of an order'
  new // first
  "in progress" [note: 'being packed']
  shipped
}

Enum kind {
  Note: {
    'Where it\\'s from'
  }
  "web shop" [note: 'online']
}
`;
  const output = generateDbPatch(source);
  const enums = new Parser().parse(output, "dbmlv2").schemas[0].enums;

  assert.equal(
    output,
    source
      .replace("  Note: 'Lifecycle of an order'\n", "")
      .replace("  new // first", "  new [note: 'Lifecycle of an order'] // first")
      .replace("  Note: {\n    'Where it\\'s from'\n  }\n", "")
      .replace(`"web shop" [note: 'online']`, `"web shop" [note: 'Where it\\'s from (online)']`),
  );
  assert.deepEqual(enums[0].values.map((value) => [value.name, value.note]), [
    ["new", "Lifecycle of an order"],
    ["in progress", "being packed"],
    ["shipped", null],
  ]);
  assert.equal(enums[1].values[0].note, "Where it's from (online)");
});
