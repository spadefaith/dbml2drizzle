const resolveType = require("./resolve-type");
const resolveDefault = require("./resolve-default");
const { cleanNote } = require("./convert-note");
const { unquote } = require("../parser/parse-definition-type");

const COLUMN_SETTINGS = [
  "note",
  "primary key",
  "pk",
  "null",
  "not null",
  "unique",
  "default",
  "increment",
  "ref",
  "delete",
  "update",
  "check",
];

const RENAMED_FROM_MESSAGE =
  "renamed_from is no longer supported: confirm renames in drizzle-kit generate's prompt";

/**
 * Parses an inline reference value such as `> accounts.id`. Returns
 * { op, to: { table, columns } } or null after reporting the problem.
 */
function parseInlineRef(value, location, collector) {
  const match = String(value).trim().match(/^(<>|>|<|-)\s*(.+)$/s);

  if (!match) {
    collector.add({ ...location, message: `Malformed reference '${value}'` });
    return null;
  }

  if (match[1] == "<>") {
    collector.add({ ...location, message: "Many-to-many references (<>) are not supported" });
    return null;
  }

  const target = match[2].trim();

  if (target.includes("(")) {
    collector.add({
      ...location,
      message: "Composite references must be written as standalone Ref: lines",
    });
    return null;
  }

  const parts = target.split(".").map((part) => unquote(part.trim()));

  if (parts.length != 2 || parts.some((part) => !part)) {
    collector.add({ ...location, message: `Malformed reference target '${target}'` });
    return null;
  }

  return { op: match[1], to: { table: parts[0], columns: [parts[1]] } };
}

/**
 * Turns parsed column lines of one table into data-model.md Columns and raw
 * inline references, plus the raw `check:` settings ([{ column, value, line }]):
 * { from: { table, columns: [column] }, op, to, onDelete, onUpdate, line, form: "inline" }
 */
module.exports = function convertAttributes(table, columnLines, collector) {
  const columns = [];
  const rawRefs = [];
  const columnChecks = [];

  for (const columnLine of columnLines) {
    const { name, typeRaw, settings, line } = columnLine;
    const location = { table, column: name, line };

    if (!typeRaw) {
      collector.add({ ...location, message: "Column is missing its type" });
      continue;
    }

    const type = resolveType(typeRaw, location, collector);
    const column = { name, type, line };
    const refs = [];
    let onDelete;
    let onUpdate;

    for (const setting of settings) {
      const { key, value } = setting;

      if (key == "renamed_from") {
        collector.add({ ...location, message: RENAMED_FROM_MESSAGE });
        continue;
      }

      if (!COLUMN_SETTINGS.includes(key)) {
        collector.add({ ...location, message: `Unknown column setting '${setting.text}'` });
        continue;
      }

      if (key == "note") column.comment = cleanNote(value);
      if (key == "pk" || key == "primary key") column.primaryKey = true;
      if (key == "increment") column.autoIncrement = true;
      if (key == "null") column.allowNull = true;
      if (key == "not null") column.allowNull = false;
      if (key == "unique") column.unique = true;
      if (key == "delete") onDelete = String(value).toUpperCase();
      if (key == "update") onUpdate = String(value).toUpperCase();
      if (key == "check") columnChecks.push({ column: name, value, line });

      if (key == "default" && type) {
        column.defaultValue = resolveDefault(value, type);
      }

      if (key == "ref") {
        const ref = parseInlineRef(value, location, collector);
        ref && refs.push(ref);
      }
    }

    if ((onDelete || onUpdate) && refs.length == 0) {
      collector.add({ ...location, message: "delete/update actions need a ref on the same column" });
    }

    for (const ref of refs) {
      rawRefs.push({
        from: { table, columns: [name] },
        op: ref.op,
        to: ref.to,
        onDelete,
        onUpdate,
        line,
        form: "inline",
      });
    }

    // kept even when its type is invalid, so references to it are checked too;
    // the collected type error stops generation anyway
    columns.push(column);
  }

  return { columns, rawRefs, columnChecks };
};

module.exports.RENAMED_FROM_MESSAGE = RENAMED_FROM_MESSAGE;
