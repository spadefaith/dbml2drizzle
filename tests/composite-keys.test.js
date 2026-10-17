const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSchema, generateMigration, DbmlError } = require("../src");
const { fakeQueryInterface, loadMigration, FakeSequelize } = require("./helpers");

const dbml = `Table products {
  shop_id integer
  code varchar(20)

  indexes {
    (shop_id, code) [pk]
  }
}

Table orders {
  id integer [pk]
  shop_id integer
  code varchar(20)
}

Table a {
  x integer
  y integer
}

Table b {
  x integer
  y integer

  indexes {
    (x, y) [pk]
  }
}

Ref: orders.(shop_id, code) > products.(shop_id, code) [delete: cascade]
Ref: a.(x, y) - b.(x, y)
`;

async function run(step) {
  const queryInterface = fakeQueryInterface();
  await loadMigration(generateMigration(dbml))[step](queryInterface, FakeSequelize);
  return queryInterface.calls;
}

test("composite references become relationships over several columns", () => {
  const [orders, ab] = parseSchema(dbml).relationships;

  assert.deepEqual(orders.from, { table: "orders", columns: ["shop_id", "code"] });
  assert.deepEqual(orders.to, { table: "products", columns: ["shop_id", "code"] });
  assert.equal(orders.composite, true);
  assert.equal(ab.kind, "one-to-one");
});

test("up adds composite foreign keys and their unique constraint after all tables", async () => {
  const calls = await run("up");
  const lastCreate = calls.map((call) => call.method).lastIndexOf("createTable");
  const constraints = calls.filter((call) => call.method == "addConstraint");

  assert.ok(calls.indexOf(constraints[0]) > lastCreate);
  assert.deepEqual(constraints.map((call) => call.args), [
    [
      "orders",
      {
        type: "foreign key",
        fields: ["shop_id", "code"],
        name: "orders_shop_id_code_fkey",
        references: { table: "products", fields: ["shop_id", "code"] },
        onDelete: "CASCADE",
        transaction: "tx",
      },
    ],
    [
      "a",
      {
        type: "foreign key",
        fields: ["x", "y"],
        name: "a_x_y_fkey",
        references: { table: "b", fields: ["x", "y"] },
        transaction: "tx",
      },
    ],
    ["a", { type: "unique", fields: ["x", "y"], name: "a_x_y_key", transaction: "tx" }],
  ]);
});

test("down removes those constraints first, in reverse order", async () => {
  const calls = await run("down");

  assert.deepEqual(calls.slice(0, 3).map((call) => call.args.slice(0, 2)), [
    ["a", "a_x_y_key"],
    ["a", "a_x_y_fkey"],
    ["orders", "orders_shop_id_code_fkey"],
  ]);
  assert.equal(calls[3].method, "dropTable");
});

test("mismatched column counts and unknown columns are errors", () => {
  const bad = `Table p {
  a integer
  b integer
}

Table q {
  a integer
}

Ref: q.(a) > p.(a, b)
Ref: q.(a, zz) > p.(a, b)
`;

  assert.throws(() => parseSchema(bad), (error) => {
    assert.ok(error instanceof DbmlError);
    assert.match(error.message, /line 10: q\.a: Composite reference sides have different column counts/);
    assert.match(error.message, /line 11: q\.a, zz: References unknown column 'q\.zz'/);
    return true;
  });
});
