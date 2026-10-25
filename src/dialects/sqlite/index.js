// @ts-check
const columnCall = require("./types");
const defaultModifier = require("./defaults");
const { collectEnums, enumDeclaration, enumColumnCall, tableChecks } = require("./enums");

/**
 * SQLite target (drizzle-orm/sqlite-core) for every SQLite database Drizzle
 * supports: Cloudflare D1, libSQL/Turso, better-sqlite3, node:sqlite, Bun, Expo.
 *
 * @type {import("../../types").Dialect}
 */
module.exports = {
  id: "sqlite",
  label: "SQLite",
  module: "drizzle-orm/sqlite-core",
  tableBuilder: "sqliteTable",
  enumBuilder: null,
  checkBuilder: "check",
  viewBuilder: "sqliteView",
  // SQLite has no materialized views
  materializedViewBuilder: null,
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
