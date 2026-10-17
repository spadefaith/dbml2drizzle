const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { parseSchema, writeSchema, DbmlError } = require("../src");
const { writeTemp } = require("./helpers");

const dbml = `Table a {
  id integer [pk]
  amount money
  kind enum()
  body text('huge')
  owner_id integer [ref: > owners.id]
  b_id integer [ref: > b.missing]

  indexes {
    nope
  }
}

Table b {
  id integer [pk]
}

Enum status {
  active
}

Table c {
  x integer [pk]
  y integer

  indexes {
    (x, y) [pk]
  }
}
`;

test("every problem in the DBML is reported together, in line order", () => {
  assert.throws(() => parseSchema(dbml), (error) => {
    assert.ok(error instanceof DbmlError);
    assert.deepEqual(
      error.errors.map(({ line, table, column, message }) => ({ line, table, column, message })),
      [
        { line: 3, table: "a", column: "amount", message: "Unsupported data type 'money'" },
        { line: 4, table: "a", column: "kind", message: "enum must have at least one value" },
        { line: 5, table: "a", column: "body", message: "text accepts only tiny, medium or long" },
        { line: 6, table: "a", column: "owner_id", message: "References unknown table 'owners'" },
        { line: 7, table: "a", column: "b_id", message: "References unknown column 'b.missing'" },
        { line: 10, table: "a", column: "nope", message: "Index refers to unknown column 'nope'" },
        {
          line: 18,
          table: undefined,
          column: undefined,
          message: "Enum blocks are not supported; use an inline enum('a','b') type",
        },
        { line: 27, table: "c", column: undefined, message: "Table 'c' declares its primary key twice" },
      ]
    );
    assert.match(error.message, /^line 3: a\.amount: Unsupported data type 'money'$/m);
    return true;
  });
});

test("writeSchema writes nothing when the DBML has errors", () => {
  const { dir, file } = writeTemp("db.dbml", dbml);

  assert.throws(() => writeSchema(file), DbmlError);
  assert.equal(fs.existsSync(path.join(dir, "db.schema.ts")), false);
});
