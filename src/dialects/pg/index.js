const columnCall = require("./types");
const defaultModifier = require("./defaults");
const { collectEnums, enumDeclaration } = require("./enums");

/**
 * PostgreSQL target (drizzle-orm/pg-core).
 */
module.exports = {
  id: "pg",
  module: "drizzle-orm/pg-core",
  tableBuilder: "pgTable",
  enumBuilder: "pgEnum",
  columnCall,
  defaultModifier,
  collectEnums,
  enumDeclaration,
};
