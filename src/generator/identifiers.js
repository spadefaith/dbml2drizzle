const RESERVED = new Set(
  (
    "await break case catch class const continue debugger default delete do else enum export " +
    "extends false finally for function if implements import in instanceof interface let new " +
    "null package private protected public return static super switch this throw true try " +
    "typeof var void while with yield arguments eval undefined NaN Infinity"
  ).split(" ")
);

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Object key for a column or relation: the name as is, quoted when it is
 * not a valid JavaScript identifier.
 */
function propertyKey(name) {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

/**
 * Property access on `object`: `object.name` or `object["first-name"]`.
 */
function member(object, name) {
  return IDENTIFIER.test(name) ? `${object}.${name}` : `${object}[${JSON.stringify(name)}]`;
}

/**
 * Exported variable name for a database name: characters that cannot appear
 * in an identifier become `_`, and a `_` is prefixed when the result starts
 * with a digit or is a reserved word.
 */
function exportName(name) {
  const cleaned = String(name).replace(/[^\w$]/g, "_");
  return /^\d/.test(cleaned) || RESERVED.has(cleaned) ? `_${cleaned}` : cleaned;
}

/**
 * Returns Map(table name → export name). Reports tables whose export names
 * collide.
 */
function tableExports(tables, collector, taken = new Map()) {
  const exports = new Map();

  for (const table of tables) {
    const id = exportName(table.name);

    if (taken.has(id)) {
      collector.add({
        table: table.name,
        line: table.line,
        message: `Table name '${taken.get(id)}' and '${table.name}' both become '${id}' in generated code`,
      });
    }

    taken.set(id, table.name);
    exports.set(table.name, id);
  }

  return exports;
}

module.exports = { propertyKey, member, exportName, tableExports };
