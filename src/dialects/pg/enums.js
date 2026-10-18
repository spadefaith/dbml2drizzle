const { exportName } = require("../../generator/identifiers");

/**
 * The PostgreSQL enums of a schema: every `Enum` block first, in file order,
 * named as written; then one enum per inline `enum(...)` column, named
 * enum_<table>_<column> (the name earlier versions of this package gave the
 * type), in table and column file order:
 * [{ ref, exportName, dbName, values, notes } | { table, column, exportName, dbName, values }].
 * Reports an `Enum` block whose name is an inline enum's type name.
 */
function collectEnums(schema, collector) {
  const shared = (schema.enums || []).map((e) => ({
    ref: e.name,
    exportName: exportName(e.name),
    dbName: e.name,
    values: e.values.map((entry) => entry.value),
    notes: [e.note, ...e.values.filter((entry) => entry.note).map((entry) => `${entry.value}: ${entry.note}`)].filter(Boolean),
    line: e.line,
  }));

  const inline = schema.tables.flatMap((table) =>
    table.columns
      .filter((column) => column.type && column.type.name == "enum" && !column.type.ref)
      .map((column) => {
        const dbName = `enum_${table.name}_${column.name}`;
        const clash = shared.find((e) => e.dbName == dbName);

        clash &&
          collector &&
          collector.add({
            line: clash.line,
            message: `Enum '${clash.dbName}' has the same name as the enum type of ${table.name}.${column.name} (line ${column.line})`,
          });

        return {
          table: table.name,
          column: column.name,
          exportName: exportName(dbName),
          dbName,
          values: column.type.args.map(String),
        };
      })
  );

  return [...shared, ...inline];
}

function enumDeclaration(e) {
  // `*/` escaped so a note cannot end the comment
  const notes = (e.notes || []).flatMap((note) => note.replace(/\*\//g, "*\\/").split(/\r?\n/));
  const comment = notes.length == 0 ? "" : notes.length == 1 ? `/** ${notes[0]} */\n` : `/**\n${notes.map((line) => ` * ${line}`).join("\n")}\n */\n`;
  return `${comment}export const ${e.exportName} = pgEnum(${JSON.stringify(e.dbName)}, [${e.values.map((value) => JSON.stringify(value)).join(", ")}]);`;
}

module.exports = { collectEnums, enumDeclaration };
