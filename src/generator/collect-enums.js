const { exportName } = require("./identifiers");

/**
 * The enums of a schema, shared by every target: every `Enum` block first,
 * in file order, named as written; then one enum per inline `enum(...)`
 * column, named enum_<table>_<column> (the name earlier versions of this
 * package gave the type), in table and column file order:
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

/**
 * The collected enum a column uses: its `Enum` block, or its inline enum.
 */
function findEnum(enums, table, column) {
  return column.type && column.type.ref
    ? enums.find((e) => e.ref == column.type.ref)
    : enums.find((e) => e.table == table.name && e.column == column.name);
}

/**
 * The notes of a collected enum as a JSDoc comment followed by a newline,
 * or "" without notes.
 */
function enumComment(e) {
  // `*/` escaped so a note cannot end the comment
  const notes = (e.notes || []).flatMap((note) => note.replace(/\*\//g, "*\\/").split(/\r?\n/));
  return notes.length == 0 ? "" : notes.length == 1 ? `/** ${notes[0]} */\n` : `/**\n${notes.map((line) => ` * ${line}`).join("\n")}\n */\n`;
}

module.exports = { collectEnums, findEnum, enumComment };
