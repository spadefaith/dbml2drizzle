const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSchema, generateMigration, DbmlError } = require("../src");

const inlineForms = `Table accounts {
  id integer [pk]
  created_by integer [ref: > accounts.id, delete: set null]

  Note: {
    'All accounts'
  }
}

Table orders {
  id integer [pk]
  account_id integer [ref: > accounts.id, delete: cascade]
  approved_by integer [ref: > accounts.id]
}

Table invoices {
  id integer [pk]
  order_id integer [ref: - orders.id, update: cascade]
}
`;

const standardForms = `Table accounts {
  id integer [pk]
  created_by integer

  Note {
    'All accounts'
  }
}

Table orders {
  id integer [pk]
  account_id integer
  approved_by integer
}

Table invoices {
  id integer [pk]
  order_id integer
}

Ref: accounts.created_by > accounts.id [delete: set null]
Ref order_owner: orders.account_id > accounts.id [delete: cascade]

Ref {
  orders.approved_by > accounts.id
}

Ref: invoices.order_id - orders.id [update: cascade]
`;

test("standalone Ref lines and Note { } give the same migration as inline forms", () => {
  assert.equal(generateMigration(standardForms), generateMigration(inlineForms));
});

test("standalone references are recorded as such", () => {
  const { relationships } = parseSchema(standardForms);

  assert.equal(relationships.length, 4);
  assert.ok(relationships.every((relationship) => relationship.declaredAt[0].form == "standalone"));
  assert.equal(parseSchema(standardForms).tables[0].comment, "All accounts");
});

test("a relationship declared inline and standalone with the same actions is merged", () => {
  const both = `${inlineForms}\nRef: orders.account_id > accounts.id [delete: cascade]\n`;
  const { relationships } = parseSchema(both);

  const merged = relationships.filter((relationship) => relationship.from.columns[0] == "account_id");
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].declaredAt.map((item) => item.form), ["inline", "standalone"]);
});

test("conflicting inline and standalone declarations name both lines", () => {
  const conflicting = `${inlineForms}\nRef: orders.account_id > accounts.id [delete: restrict]\n`;

  assert.throws(() => parseSchema(conflicting), (error) => {
    assert.ok(error instanceof DbmlError);
    assert.match(error.message, /Conflicting declarations of orders\.account_id → accounts\.id \(lines 12 and 21\)/);
    return true;
  });
});

test("malformed standalone references are reported", () => {
  assert.throws(
    () => parseSchema(`${inlineForms}\nRef: orders.account_id accounts.id\n`),
    /line 21: Malformed reference 'orders\.account_id accounts\.id'/
  );
});
