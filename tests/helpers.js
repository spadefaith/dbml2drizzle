const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * Writes `text` to `<new temp folder>/<name>` and returns both paths.
 */
function writeTemp(name, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbml2sequelize-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return { dir, file };
}

/**
 * A stand-in for Sequelize's queryInterface that records every call in order.
 */
function fakeQueryInterface({ dialect = "postgres" } = {}) {
  const calls = [];
  const record = (method) => async (...args) => {
    calls.push({ method, args });
  };

  return {
    calls,
    createTable: record("createTable"),
    addConstraint: record("addConstraint"),
    addIndex: record("addIndex"),
    removeConstraint: record("removeConstraint"),
    dropTable: record("dropTable"),
    addColumn: record("addColumn"),
    removeColumn: record("removeColumn"),
    changeColumn: record("changeColumn"),
    renameTable: record("renameTable"),
    renameColumn: record("renameColumn"),
    removeIndex: record("removeIndex"),
    dropEnum: record("dropEnum"),
    sequelize: {
      getDialect: () => dialect,
      query: record("query"),
      transaction: async (fn) => fn("tx"),
    },
  };
}

/**
 * Loads generated migration source as a module without touching the disk.
 */
function loadMigration(source) {
  const module = { exports: {} };
  new Function("module", "exports", "require", source)(module, module.exports, require);
  return module.exports;
}

/**
 * A Sequelize stand-in for running generated migrations: data types and
 * helpers become plain descriptions that tests can compare.
 */
const FakeSequelize = new Proxy(
  {
    fn: (name) => ({ fn: name }),
    literal: (value) => ({ literal: value }),
  },
  {
    get(target, prop) {
      if (prop in target) return target[prop];
      const type = (...args) => ({ type: prop, args });
      type.type = prop;
      type.args = [];
      return type;
    },
  }
);

/**
 * Writes `dbmlText` to `<new temp folder>/db.dbml` and its snapshot to
 * `<same folder>/migrations/dbml2sequelize-snapshot.json`.
 */
function writeSnapshotTemp(dbmlText) {
  const { generateSnapshot } = require("../src");
  const { dir, file } = writeTemp("db.dbml", dbmlText);
  const snapshotPath = path.join(dir, "migrations", "dbml2sequelize-snapshot.json");

  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, generateSnapshot(dbmlText, { source: "db.dbml" }));

  return { dir, file, snapshotPath };
}

module.exports = { writeTemp, writeSnapshotTemp, fakeQueryInterface, loadMigration, FakeSequelize };
