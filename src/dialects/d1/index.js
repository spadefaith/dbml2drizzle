// @ts-check
const columnCall = require("./types");
const defaultModifier = require("./defaults");
const { collectEnums, enumDeclaration, enumColumnCall, tableChecks } = require("./enums");

/**
 * Cloudflare D1 target (drizzle-orm/sqlite-core; drizzle-kit dialect
 * "sqlite", driver "d1-http").
 *
 * @type {import("../../types").Dialect}
 */
module.exports = {
  id: "d1",
  label: "D1",
  module: "drizzle-orm/sqlite-core",
  tableBuilder: "sqliteTable",
  enumBuilder: null,
  checkBuilder: "check",
  anyColumnType: "AnySQLiteColumn",
  columnCall,
  defaultModifier,
  collectEnums,
  enumDeclaration,
  enumColumnCall,
  tableChecks,
  // SQLite has no index types (e.g. gin)
  indexTypes: false,
  // SQLite auto-increments only the single integer primary key
  primaryKeyModifier: (column) => (column.autoIncrement ? ".primaryKey({ autoIncrement: true })" : ".primaryKey()"),
};
