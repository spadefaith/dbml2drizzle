// @ts-check
const columnCall = require("./types");
const defaultModifier = require("./defaults");
const { collectEnums, enumDeclaration } = require("./enums");

/**
 * PostgreSQL target (drizzle-orm/pg-core).
 *
 * @type {import("../../types").Dialect}
 */
module.exports = {
  id: "pg",
  label: "PostgreSQL",
  module: "drizzle-orm/pg-core",
  tableBuilder: "pgTable",
  enumBuilder: "pgEnum",
  checkBuilder: "check",
  anyColumnType: "AnyPgColumn",
  columnCall,
  defaultModifier,
  collectEnums,
  enumDeclaration,
};
