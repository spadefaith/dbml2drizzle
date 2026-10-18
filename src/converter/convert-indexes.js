const { cleanNote } = require("./convert-note");
const { expressionOf } = require("./convert-checks");

const INDEX_SETTINGS = ["type", "name", "unique", "pk", "note", "where"];

const PK_MESSAGE = "A primary key cannot have an expression or a where condition";

/**
 * `text` as a single-quoted DBML string.
 */
const quoted = (text) => `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/**
 * Patch edit for an index line with `where:`, which standard DBML rejects:
 * the line without `where`, its condition kept in the entry's note
 * (see research R5).
 */
function whereEdit({ settings, line, indent, target, trailing }, where) {
  const kept = settings.filter((setting) => setting.key != "where");
  const note = kept.find((setting) => setting.key == "note");
  const noteText = note ? `${cleanNote(note.value)} (where ${where})` : `where ${where}`;
  const texts = kept.map((setting) => (setting == note ? `note: ${quoted(noteText)}` : setting.text));

  note || texts.push(`note: ${quoted(noteText)}`);

  return { line, replacement: `${indent}${target} [${texts.join(", ")}]${trailing}` };
}

/**
 * Turns parsed `indexes { }` lines of one table into data-model.md Indexes:
 * { fields, parts, name, unique, using, where }. Entries marked `pk` are
 * returned separately in `primaryKeys` ([{ fields, line }]) because they
 * declare the table's primary key rather than an index. `patchEdits` move
 * each `where` into the entry's note for `db-patch.dbml`.
 */
module.exports = function convertIndexes(table, columns, indexLines, collector) {
  const indexes = [];
  const primaryKeys = [];
  const patchEdits = [];

  for (const indexLine of indexLines) {
    const { parts, fields, settings, line } = indexLine;
    const location = { table, line };
    const expressions = parts.filter((part) => "expression" in part);

    const unknownField = fields.find((field) => !columns.some((column) => column.name == field));

    if (unknownField) {
      collector.add({ ...location, column: unknownField, message: `Index refers to unknown column '${unknownField}'` });
      continue;
    }

    const index = { fields, parts };
    let isPrimaryKey = false;
    let valid = true;
    let wheres = 0;

    for (const setting of settings) {
      const { key, value } = setting;

      if (!INDEX_SETTINGS.includes(key)) {
        collector.add({ ...location, message: `Unknown index setting '${setting.text}'` });
        valid = false;
        continue;
      }

      if (key == "pk") isPrimaryKey = true;
      if (key == "unique") index.unique = true;
      if (key == "type") index.using = String(value).toUpperCase();
      if (key == "name") index.name = cleanNote(value);

      if (key == "where" && ++wheres == 1) {
        index.where = expressionOf(value);
      }
    }

    if (expressions.some((part) => part.expression === null)) {
      collector.add({ ...location, message: "Index expression must be a backtick expression" });
      valid = false;
    } else if (expressions.some((part) => !part.expression)) {
      collector.add({ ...location, message: "Index expression is empty" });
      valid = false;
    }

    if (wheres > 1) {
      collector.add({ ...location, message: "An index takes one where condition" });
      valid = false;
    } else if (wheres && index.where === null) {
      collector.add({ ...location, message: "where must be a backtick expression, e.g. where: `deleted_at is null`" });
      valid = false;
    } else if (wheres && !index.where) {
      collector.add({ ...location, message: "Index condition is empty" });
      valid = false;
    }

    if (isPrimaryKey && (expressions.length || wheres)) {
      collector.add({ ...location, message: PK_MESSAGE });
      continue;
    }

    if (isPrimaryKey) {
      primaryKeys.push({ fields, line });
      continue;
    }

    if (expressions.length && !index.name && valid) {
      collector.add({ ...location, message: "Expression indexes need a name, e.g. [name: 'users_email_lower']" });
      valid = false;
    }

    if (!valid) {
      continue;
    }

    index.where && patchEdits.push(whereEdit(indexLine, index.where));
    indexes.push({
      fields: index.fields,
      parts: index.parts,
      name: index.name || `${table}_${fields.join("_")}`,
      ...(index.unique && { unique: true }),
      ...(index.using && { using: index.using }),
      ...(index.where && { where: index.where }),
    });
  }

  return { indexes, primaryKeys, patchEdits };
};
