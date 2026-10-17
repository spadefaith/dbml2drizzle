const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSchema } = require("../src");

function columnsOf(body) {
  const table = parseSchema(`Table t {\n${body}\n}`).tables[0];
  return Object.fromEntries(table.columns.map((column) => [column.name, column]));
}

test("maps every supported DBML type to a Sequelize data type", () => {
  const columns = columnsOf(`  a varchar(100)
  b varchar
  c string
  d char(2)
  e text
  f text('long')
  g integer
  h int
  i bigint
  j smallint
  k decimal(18,2)
  l numeric(10, 4)
  m float
  n double
  o real
  p boolean
  q bool
  r timestamp
  s timestamptz
  u datetime
  v date
  w dateonly
  x time
  y json
  z jsonb
  aa uuid
  ab enum('a, b', 'c')
  ac timestamp(6)
  ad time(6)
  ae TIMESTAMP`);

  const expected = {
    a: ["STRING", [100]],
    b: ["STRING", []],
    c: ["STRING", []],
    d: ["CHAR", [2]],
    e: ["TEXT", []],
    f: ["TEXT", ["long"]],
    g: ["INTEGER", []],
    h: ["INTEGER", []],
    i: ["BIGINT", []],
    j: ["SMALLINT", []],
    k: ["DECIMAL", [18, 2]],
    l: ["DECIMAL", [10, 4]],
    m: ["FLOAT", []],
    n: ["DOUBLE", []],
    o: ["REAL", []],
    p: ["BOOLEAN", []],
    q: ["BOOLEAN", []],
    r: ["DATE", []],
    s: ["DATE", []],
    u: ["DATE", []],
    v: ["DATE", []],
    w: ["DATEONLY", []],
    x: ["TIME", []],
    y: ["JSON", []],
    z: ["JSONB", []],
    aa: ["UUID", []],
    ab: ["ENUM", ["a, b", "c"]],
    ac: ["DATE", [6]],
    ad: ["TIME", [6]],
    ae: ["DATE", []],
  };

  for (const [name, [type, args]] of Object.entries(expected)) {
    assert.deepEqual(columns[name].type, { name: type, args }, name);
  }
});

test("converts defaults to their intended value", () => {
  const columns = columnsOf(`  a timestamp [default: \`now()\`]
  b timestamp [default: now()]
  c timestamp [default: \`CURRENT_TIMESTAMP\`]
  d timestamp [default: CURRENT_TIMESTAMP]
  e varchar [default: \`lower('X')\`]
  f varchar [default: 'active']
  g varchar [default: null]
  h boolean [default: 1]
  i boolean [default: 0]
  j boolean [default: true]
  k boolean [default: false]
  l integer [default: 42]
  m decimal [default: -1.5]
  n varchar [default: 'it\\'s']`);

  assert.deepEqual(columns.a.defaultValue, { kind: "fn", value: "now" });
  assert.deepEqual(columns.b.defaultValue, { kind: "fn", value: "now" });
  assert.deepEqual(columns.c.defaultValue, { kind: "literal", value: "CURRENT_TIMESTAMP" });
  assert.deepEqual(columns.d.defaultValue, { kind: "literal", value: "CURRENT_TIMESTAMP" });
  assert.deepEqual(columns.e.defaultValue, { kind: "literal", value: "lower('X')" });
  assert.deepEqual(columns.f.defaultValue, { kind: "value", value: "active" });
  assert.deepEqual(columns.g.defaultValue, { kind: "value", value: null });
  assert.deepEqual(columns.h.defaultValue, { kind: "value", value: true });
  assert.deepEqual(columns.i.defaultValue, { kind: "value", value: false });
  assert.deepEqual(columns.j.defaultValue, { kind: "value", value: true });
  assert.deepEqual(columns.k.defaultValue, { kind: "value", value: false });
  assert.deepEqual(columns.l.defaultValue, { kind: "value", value: 42 });
  assert.deepEqual(columns.m.defaultValue, { kind: "value", value: -1.5 });
  assert.deepEqual(columns.n.defaultValue, { kind: "value", value: "it's" });
});
