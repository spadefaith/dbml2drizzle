const test = require("node:test");
const assert = require("node:assert/strict");
const { DbmlError } = require("../src");
const { generate } = require("./helpers");

const column = (definition) => generate(`Table t {\n  c ${definition}\n}\n`);

const cases = [
  ["varchar(100)", 'varchar("c", { length: 100 })'],
  ["varchar", 'varchar("c")'],
  ["string(50)", 'varchar("c", { length: 50 })'],
  ["char(2)", 'char("c", { length: 2 })'],
  ["text", 'text("c")'],
  ["text('long')", 'text("c")'],
  ["int", 'integer("c")'],
  ["integer", 'integer("c")'],
  ["smallint", 'smallint("c")'],
  ["bigint", 'bigint("c", { mode: "number" })'],
  ["decimal(18,2)", 'numeric("c", { precision: 18, scale: 2 })'],
  ["numeric(18,2)", 'numeric("c", { precision: 18, scale: 2 })'],
  ["decimal", 'numeric("c")'],
  ["float", 'doublePrecision("c")'],
  ["double", 'doublePrecision("c")'],
  ["real", 'real("c")'],
  ["bool", 'boolean("c")'],
  ["boolean", 'boolean("c")'],
  ["timestamp", 'timestamp("c")'],
  ["datetime", 'timestamp("c")'],
  ["timestamptz", 'timestamp("c", { withTimezone: true })'],
  ["date", 'date("c")'],
  ["dateonly", 'date("c")'],
  ["time", 'time("c")'],
  ["json", 'json("c")'],
  ["jsonb", 'jsonb("c")'],
  ["uuid", 'uuid("c")'],
];

for (const [type, expected] of cases) {
  test(`${type} → ${expected}`, () => {
    assert.ok(column(type).includes(`  c: ${expected},\n`), column(type));
  });
}

test("increment becomes an identity column on integer, bigint and smallint", () => {
  assert.match(column("int [increment]"), /c: integer\("c"\)\.generatedByDefaultAsIdentity\(\),/);
  assert.match(column("bigint [increment]"), /c: bigint\("c", \{ mode: "number" \}\)\.generatedByDefaultAsIdentity\(\),/);
  assert.match(column("smallint [increment]"), /c: smallint\("c"\)\.generatedByDefaultAsIdentity\(\),/);
});

test("increment on another type is an error naming the column", () => {
  assert.throws(() => column("varchar [increment]"), (error) => {
    assert.ok(error instanceof DbmlError);
    assert.match(error.message, /^line 2: t\.c: increment needs integer, bigint or smallint$/m);
    return true;
  });
});

test("now() becomes defaultNow()", () => {
  assert.match(column("timestamptz [default: `now()`]"), /\.defaultNow\(\),/);
});

test("other expressions become sql`...` and import sql", () => {
  const output = column("uuid [default: `gen_random_uuid()`]");
  assert.match(output, /c: uuid\("c"\)\.default\(sql`gen_random_uuid\(\)`\),/);
  assert.match(output, /^import \{ sql \} from "drizzle-orm";$/m);
});

test("literal defaults keep their value and type", () => {
  assert.match(column("varchar [default: 'active']"), /\.default\("active"\),/);
  assert.match(column("int [default: 3]"), /\.default\(3\),/);
  assert.match(column("boolean [default: true]"), /\.default\(true\),/);
  assert.match(column("int [default: null]"), /\.default\(null\),/);
});

test("no sql import without expression defaults", () => {
  assert.doesNotMatch(column("int [default: 3]"), /from "drizzle-orm";/);
});
