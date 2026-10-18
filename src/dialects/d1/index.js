const columnCall = require("./types");
const defaultModifier = require("./defaults");
const { collectEnums, enumDeclaration, enumColumnCall, tableChecks } = require("./enums");

/**
 * Cloudflare D1 target (drizzle-orm/sqlite-core; drizzle-kit dialect
 * "sqlite", driver "d1-http").
 */
module.exports = {
  id: "d1",
  label: "D1",
  module: "drizzle-orm/sqlite-core",
  tableBuilder: "sqliteTable",
  enumBuilder: null,
  checkBuilder: "check",
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
