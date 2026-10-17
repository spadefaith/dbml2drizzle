const test = require("node:test");
const assert = require("node:assert/strict");
const { generateMigration } = require("../src");
const { fakeQueryInterface, loadMigration, FakeSequelize } = require("./helpers");

const dbml = `Table a {
  id integer [pk]
  b_id integer [ref: > b.id, delete: cascade]
  status enum('on', 'off')
}

Table b {
  id integer [pk]
  a_id integer [ref: > a.id]
}

Table c {
  id integer [pk]
  kind enum('x', 'y')
}
`;

async function run(step, dialect) {
  const queryInterface = fakeQueryInterface({ dialect });
  await loadMigration(generateMigration(dbml))[step](queryInterface, FakeSequelize);
  return queryInterface.calls;
}

test("up adds the foreign key that closes a cycle after both tables exist", async () => {
  const calls = await run("up", "postgres");

  // c is ready first; the a <-> b cycle is only broken when no table is ready
  assert.deepEqual(calls.map((call) => `${call.method} ${call.args[0]}`), [
    "createTable c",
    "createTable a",
    "createTable b",
    "addConstraint a",
  ]);
  assert.deepEqual(calls[3].args[1], {
    type: "foreign key",
    fields: ["b_id"],
    name: "a_b_id_fkey",
    references: { table: "b", field: "id" },
    onDelete: "CASCADE",
    transaction: "tx",
  });
  assert.equal(calls[1].args[1].b_id.references, undefined);
});

test("down removes constraints, drops tables in reverse order, then enum types on postgres", async () => {
  const calls = await run("down", "postgres");

  assert.deepEqual(calls.map((call) => [call.method, ...call.args]), [
    ["removeConstraint", "a", "a_b_id_fkey", { transaction: "tx" }],
    ["dropTable", "b", { transaction: "tx" }],
    ["dropTable", "a", { transaction: "tx" }],
    ["dropTable", "c", { transaction: "tx" }],
    ["dropEnum", "enum_c_kind", { transaction: "tx" }],
    ["dropEnum", "enum_a_status", { transaction: "tx" }],
  ]);
});

test("down drops no enum types on other databases", async () => {
  const calls = await run("down", "mysql");
  assert.equal(calls.some((call) => call.method == "dropEnum" || call.method == "query"), false);
});

test("the migration never runs raw SQL", async () => {
  assert.doesNotMatch(generateMigration(dbml), /sequelize\.query\(/);

  for (const step of ["up", "down"]) {
    assert.equal((await run(step, "postgres")).some((call) => call.method == "query"), false);
  }
});

test("every call in up and down runs inside the transaction", async () => {
  for (const step of ["up", "down"]) {
    for (const call of await run(step, "postgres")) {
      assert.equal(call.args[call.args.length - 1].transaction, "tx", `${step}: ${call.method}`);
    }
  }
});
