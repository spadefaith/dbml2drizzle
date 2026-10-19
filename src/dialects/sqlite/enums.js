const { collectEnums, findEnum, enumComment } = require("../../generator/collect-enums");
const checkIncrement = require("./increment");

/**
 * A SQLite enum declaration: SQLite has no enum type, so the values are declared
 * once as a constant, `export const <name> = [...] as const`, with the
 * enum's notes as a JSDoc comment.
 */
function enumDeclaration(e) {
  return `${enumComment(e)}export const ${e.exportName} = [${e.values.map((value) => JSON.stringify(value)).join(", ")}] as const;`;
}

/**
 * A column using an enum: text limited to the enum's values, or null after
 * reporting an `increment` on it.
 */
function enumColumnCall(enumDef, column, location, collector, table) {
  if (!checkIncrement(column, location, collector, table)) {
    return null;
  }

  return { builders: ["text"], text: `text(${JSON.stringify(column.name)}, { enum: ${enumDef.exportName} })` };
}

const sqlName = (name) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`);

const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;

/**
 * One check per enum column, in column order, that enforces its values in
 * the database: { name: "<table>_<column>_enum", column, expression }.
 */
function tableChecks(table, enums) {
  return table.columns.flatMap((column) => {
    const e = findEnum(enums, table, column);

    return e
      ? [{
        name: `${table.name}_${column.name}_enum`,
        column: column.name,
        expression: `${sqlName(column.name)} IN (${e.values.map(sqlString).join(", ")})`,
      }]
      : [];
  });
}

module.exports = { collectEnums, enumDeclaration, enumColumnCall, tableChecks };
