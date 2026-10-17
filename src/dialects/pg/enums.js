const { exportName } = require("../../generator/identifiers");

/**
 * One PostgreSQL enum per enum column, named enum_<table>_<column> (the name
 * earlier versions of this package gave the type), in table and column file order:
 * [{ table, column, exportName, dbName, values }].
 */
function collectEnums(schema) {
  return schema.tables.flatMap((table) =>
    table.columns
      .filter((column) => column.type && column.type.name == "enum")
      .map((column) => {
        const dbName = `enum_${table.name}_${column.name}`;
        return {
          table: table.name,
          column: column.name,
          exportName: exportName(dbName),
          dbName,
          values: column.type.args.map(String),
        };
      })
  );
}

function enumDeclaration(e) {
  return `export const ${e.exportName} = pgEnum(${JSON.stringify(e.dbName)}, [${e.values.map((value) => JSON.stringify(value)).join(", ")}]);`;
}

module.exports = { collectEnums, enumDeclaration };
