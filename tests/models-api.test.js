const test = require("node:test");
const assert = require("node:assert/strict");
const { Sequelize, DataTypes } = require("sequelize");
const parseDbml = require("../src");
const { writeTemp } = require("./helpers");

const dbml = `Table accounts {
  id integer [pk, increment]
  created_by integer [ref: > accounts.id, delete: set null]
  details jsonb
  status varchar(50) [default: 'active', note: 'active, paused, etc.']
  created_dt timestamp [default: \`now()\`]

  Note {
    'All accounts'
  }
}

Table kycs {
  id integer [pk, increment]
  account_id integer [ref: - accounts.id, delete: cascade, not null]
}
`;

test("the default export still defines one model per table", () => {
  const { file } = writeTemp("db.dbml", dbml);
  const sequelize = new Sequelize("db", "u", "p", { dialect: "postgres", logging: false });

  const models = parseDbml(sequelize, DataTypes, file, { timestamps: false });

  assert.deepEqual(models.map((model) => model.name), ["accounts", "kycs"]);

  const accounts = models[0].getAttributes();
  assert.ok(accounts.details.type instanceof DataTypes.JSONB);
  assert.deepEqual(accounts.created_by.references, { model: "accounts", key: "id" });
  assert.equal(accounts.created_by.onDelete, "SET NULL");
  assert.equal(accounts.status.defaultValue, "active");
  assert.equal(accounts.status.comment, "active, paused, etc.");
  assert.equal(models[0].options.comment, "All accounts");

  const kycs = models[1].getAttributes();
  assert.equal(kycs.account_id.unique, true);
  assert.equal(kycs.account_id.allowNull, false);
});
