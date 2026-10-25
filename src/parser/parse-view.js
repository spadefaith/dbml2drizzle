const parseSettings = require("../utils/parse-settings");
const parseDefinitionType = require("./parse-definition-type");
const parseTableContent = require("./parse-table-content");
const resolveType = require("../converter/resolve-type");
const convertNote = require("../converter/convert-note");
const { expressionOf } = require("../converter/convert-checks");
const { RENAMED_FROM_MESSAGE } = require("../converter/convert-attributes");
const { cleanNote } = convertNote;

const VIEW_SETTINGS = ["materialized"];
const VIEW_COLUMN_SETTINGS = ["note", "not null"];
// column settings a table accepts but a view cannot express
const TABLE_ONLY_SETTINGS = ["pk", "primary key", "null", "unique", "default", "increment", "ref", "delete", "update", "check"];

/**
 * The columns of a view from its column lines: { name, type, line } plus
 * `comment` (from `note:`) and `allowNull: false` (from `not null`).
 * Columns without a type are left out after their error is reported.
 */
function viewColumns(name, columnLines, collector, enums) {
  const columns = [];
  const seen = new Set();

  for (const { name: column, typeRaw, settings, line } of columnLines) {
    const location = { table: name, column, line };

    seen.has(column) && collector.add({ ...location, message: "Duplicate column" });
    seen.add(column);

    if (!typeRaw) {
      collector.add({ ...location, message: "Column is missing its type" });
      continue;
    }

    const type = resolveType(typeRaw, location, collector, enums);
    const entry = { name: column, type, line };

    if (type && type.name == "enum" && !type.ref) {
      collector.add({ ...location, message: "A view column cannot declare an enum; use an Enum block" });
    }

    for (const setting of settings) {
      if (setting.key == "renamed_from") {
        collector.add({ ...location, message: RENAMED_FROM_MESSAGE });
      } else if (TABLE_ONLY_SETTINGS.includes(setting.key)) {
        collector.add({ ...location, message: `'${setting.text}' is not allowed on a view column` });
      } else if (!VIEW_COLUMN_SETTINGS.includes(setting.key)) {
        collector.add({ ...location, message: `Unknown column setting '${setting.text}'` });
      } else if (setting.key == "note") {
        entry.comment = cleanNote(setting.value);
      } else {
        entry.allowNull = false;
      }
    }

    columns.push(entry);
  }

  return columns;
}

/**
 * `text` for a '''…''' note that @dbml/core reads back exactly.
 */
const noteText = (text) => text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/**
 * Patch edits for `db-patch.dbml`, which has no View block (research R4): the
 * header becomes `Table <name as written> {` plus a note holding the view's
 * kind, its query and its own note; the `as:` and note lines are removed.
 * Column lines are standard DBML and stay as they are.
 */
function viewEdits(block, definition, view, removedItems, noteBlocks) {
  const indent = block.raw.match(/^\s*/)[0];
  const inner = `${indent}  `;
  let target = block.header.replace(/^\w+\s*/, "");
  definition.settings && (target = target.substring(0, target.lastIndexOf(definition.settings)));
  // "View v as V": the alias is dropped, as for tables
  const nameText = target.split(/\s+as\s+/i)[0].trim();
  const comment = block.commentIndex > -1 ? ` ${block.raw.substring(block.commentIndex)}` : "";
  const noteLines = (text) => noteText(text).split(/\r?\n/).map((line) => (line ? `${inner}${line}` : ""));

  const replacementLines = [
    `${indent}Table ${nameText} {${comment}`,
    `${inner}Note: '''`,
    `${inner}${view.materialized ? "Materialized view" : "View"}: ${noteText(view.name)}`,
    ...noteLines(view.query),
    ...(view.comment ? ["", ...noteLines(view.comment)] : []),
    `${inner}'''`,
  ];
  const edits = [{ line: block.line, replacementLines }];
  const remove = (from, to) => {
    for (let line = from; line <= to; line++) edits.push({ line, remove: true });
  };

  removedItems.forEach((item) => remove(item.line, item.line + item.raw.split(/\r?\n/).length - 1));
  noteBlocks.forEach((nested) => remove(nested.line, nested.endLine || nested.line));

  return edits;
}

/**
 * Parses a top-level `View name [materialized] { ... }` block into
 * specs/012-dbml-views/data-model.md View:
 * { name, materialized, columns, query, comment, line }. Each line is a
 * column (`name type [settings]`), the query (``as: `select …` ``) or a
 * `Note: '...'` line; a nested `Note { }` block is the view's note too.
 * Problems are reported to `collector` (contracts/dbml-views.md, Errors).
 * `enums` (Map name → Enum) resolves column types that name an `Enum` block.
 * `patchEdits` turn the block into a standard `Table` in `db-patch.dbml`.
 */
module.exports = function parseView(block, definition, collector, enums) {
  const { name } = definition;
  const location = { table: name, line: block.line };
  const settings = definition.settings ? parseSettings(definition.settings) : [];
  const columnLines = [];
  const queries = [];
  const noteItems = [];
  const noteBlocks = [];
  let comment = "";

  if (name.includes(".")) {
    collector.add({ ...location, message: `Schema-qualified view names are not supported: '${name}'` });
  }

  for (const setting of settings) {
    VIEW_SETTINGS.includes(setting.key) ||
      collector.add({ ...location, message: `Unknown view setting '${setting.text}'` });
  }

  for (const item of block.items) {
    if (/^as\s*:/i.test(item.text)) {
      queries.push(item);
      continue;
    }

    const parsed = parseTableContent(item);

    if (parsed.kind == "note") {
      comment = cleanNote(parsed.value);
      noteItems.push(item);
    } else {
      columnLines.push(parsed);
    }
  }

  for (const nested of block.blocks) {
    const nestedDefinition = parseDefinitionType(nested, collector);

    if (nestedDefinition && nestedDefinition.type == "Note") {
      comment = convertNote(nested);
      noteBlocks.push(nested);
    } else if (nestedDefinition) {
      collector.add({ table: name, line: nested.line, message: `'${nested.header}' is not allowed inside a View` });
    }
  }

  let query = "";

  if (queries.length == 0) {
    collector.add({ ...location, message: `View '${name}' has no query; add as: \`select …\`` });
  } else {
    const item = queries[0];
    const expression = expressionOf(item.text.substring(item.text.indexOf(":") + 1));

    if (expression === null) {
      collector.add({ table: name, line: item.line, message: "as must be a backtick expression, e.g. as: `select …`" });
    } else if (!expression) {
      collector.add({ table: name, line: item.line, message: "View query is empty" });
    }

    query = expression || "";
  }

  for (const item of queries.slice(1)) {
    collector.add({ table: name, line: item.line, message: `View '${name}' has more than one query` });
  }

  if (columnLines.length == 0) {
    collector.add({ ...location, message: "View has no columns" });
  }

  const view = {
    name,
    materialized: settings.some((setting) => setting.key == "materialized"),
    columns: viewColumns(name, columnLines, collector, enums),
    query,
    comment,
    line: block.line,
  };

  return { view, patchEdits: viewEdits(block, definition, view, [...queries, ...noteItems], noteBlocks) };
};
