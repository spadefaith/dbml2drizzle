const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSchema, DbmlError } = require("../src");

const dbml = `Project shop {
  database_type: 'postgres'
  Note: 'project note'
}

Table customers {
  id integer [pk, increment]
  email varchar(100) [unique, not null]
  Note: 'people who buy'
}

Table orders {
  id integer [pk]
  customer_id integer [ref: > customers.id]
  placed_at timestamp

  indexes {
    customer_id
    (customer_id, placed_at) [unique, name: 'orders_by_customer']
  }
}

Table order_lines {
  order_id integer
  line_no integer
  qty integer

  indexes {
    (order_id, line_no) [pk]
  }
}

TableGroup sales {
  orders
  order_lines
}
`;

test("parses tables and columns in file order with line numbers", () => {
  const schema = parseSchema(dbml);

  assert.deepEqual(schema.tables.map((table) => table.name), ["customers", "orders", "order_lines"]);
  assert.deepEqual(schema.tables[0].columns.map((column) => column.name), ["id", "email"]);
  assert.equal(schema.tables[0].line, 6);
  assert.equal(schema.tables[0].columns[1].line, 8);
  assert.equal(schema.tables[0].comment, "people who buy");
});

test("skips Project and TableGroup blocks", () => {
  const schema = parseSchema(dbml);
  assert.equal(schema.tables.some((table) => table.name == "shop" || table.name == "sales"), false);
});

test("names indexes as declared or <table>_<field>_<field>", () => {
  const orders = parseSchema(dbml).tables[1];

  assert.deepEqual(orders.indexes, [
    { fields: ["customer_id"], name: "orders_customer_id" },
    { fields: ["customer_id", "placed_at"], name: "orders_by_customer", unique: true },
  ]);
});

test("turns an index-level pk into a composite primary key, not an index", () => {
  const lines = parseSchema(dbml).tables[2];

  assert.equal(lines.columns.find((column) => column.name == "order_id").primaryKey, true);
  assert.equal(lines.columns.find((column) => column.name == "line_no").primaryKey, true);
  assert.equal(lines.columns.find((column) => column.name == "qty").primaryKey, undefined);
  assert.deepEqual(lines.indexes, []);
});

test("reports a primary key declared twice", () => {
  const twice = `Table t {
  a integer [pk]
  b integer

  indexes {
    (a, b) [pk]
  }
}`;

  assert.throws(() => parseSchema(twice), (error) => {
    assert.ok(error instanceof DbmlError);
    assert.match(error.message, /line 6: t: Table 't' declares its primary key twice/);
    return true;
  });
});

test("reads triple-quoted notes that span several lines", () => {
  const schema = parseSchema(`Table a {
  id integer [pk]
  Note: '''
    First line
    second { line } // still part of the note
  '''
}

Table b {
  id integer [pk]
  Note {
    '''
    block form
    '''
  }
}`);

  assert.equal(schema.tables[0].comment, "First line\n    second { line } // still part of the note");
  assert.equal(schema.tables[1].comment, "block form");
  assert.deepEqual(schema.tables[0].columns.map((column) => column.name), ["id"]);
});

test("contains plain data only, no Sequelize objects", () => {
  const schema = parseSchema(dbml);
  assert.deepEqual(JSON.parse(JSON.stringify(schema)), schema);
});
