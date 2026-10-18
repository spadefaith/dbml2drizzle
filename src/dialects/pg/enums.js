const { collectEnums, enumComment } = require("../../generator/collect-enums");

/**
 * A PostgreSQL enum declaration: `export const <name> = pgEnum(...)`, with
 * the enum's notes as a JSDoc comment.
 */
function enumDeclaration(e) {
  return `${enumComment(e)}export const ${e.exportName} = pgEnum(${JSON.stringify(e.dbName)}, [${e.values.map((value) => JSON.stringify(value)).join(", ")}]);`;
}

module.exports = { collectEnums, enumDeclaration };
