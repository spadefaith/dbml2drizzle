const grouping = require("./utils/grouping");
const parseSettings = require("./utils/parse-settings");
const { createCollector } = require("./errors");

const parseDefinitionType = require("./parser/parse-definition-type");
const parseTableContent = require("./parser/parse-table-content");
const parseIndexesContent = require("./parser/parse-indexes-content");
const convertAttributes = require("./converter/convert-attributes");
const convertIndexes = require("./converter/convert-indexes");
const convertNote = require("./converter/convert-note");
const resolveRelationships = require("./converter/resolve-relationships");
const parseRefLine = require("./parser/parse-ref-line");
const { cleanNote } = convertNote;
const { RENAMED_FROM_MESSAGE } = convertAttributes;

const TABLE_SETTINGS = ["note", "headercolor"];
const MOVED_SETTINGS = ["ref", "delete", "update"];

const settingsText = (settings) =>
  settings.length ? ` [${settings.map((setting) => setting.text).join(", ")}]` : "";

/**
 * Patch edits for one column line that standard DBML rejects: an inline
 * ref with delete:/update: becomes a standalone `Ref:` line with the
 * direction as written. The line keeps its other settings and its
 * trailing comment, and gets a single replacement (see data-model.md
 * PatchEdit).
 */
function columnLineEdits(table, columnLine) {
  const { name, settings, head, trailing, line } = columnLine;
  const actions = settings.filter((setting) => setting.key == "delete" || setting.key == "update");
  const refs = settings.filter((setting) => setting.key == "ref");

  if (actions.length == 0 || refs.length == 0) {
    return [];
  }

  const kept = settings.filter((setting) => !MOVED_SETTINGS.includes(setting.key));
  const replacement = `${head}${settingsText(kept)}${trailing}`;
  const actionText = actions.map((setting) => `${setting.key}: ${setting.value}`).join(", ");

  return refs.map((ref, index) => {
    const [, op, target] = String(ref.value).trim().match(/^(<>|>|<|-)\s*(.+)$/s);
    const edit = { line, appendRef: `Ref: ${table}.${name} ${op} ${target.trim()} [${actionText}]` };
    index == 0 && (edit.replacement = replacement);
    return edit;
  });
}

/**
 * Patch edits for every `Note: {` block, at any depth: `Note {`.
 */
function noteBlockEdits(blocks) {
  return blocks.flatMap((block) => [
    ...(/^note\s*:$/i.test(block.header)
      ? [{ line: block.line, replacement: block.raw.replace(/(note)\s*:\s*\{/i, "$1 {") }]
      : []),
    ...noteBlockEdits(block.blocks),
  ]);
}

function parseTable(block, definition, collector) {
  const name = definition.name;
  const columnLines = [];
  let comment = "";
  let indexLines = [];

  for (const setting of definition.settings ? parseSettings(definition.settings) : []) {
    if (setting.key == "renamed_from") {
      collector.add({ table: name, line: block.line, message: RENAMED_FROM_MESSAGE });
    } else if (!TABLE_SETTINGS.includes(setting.key)) {
      collector.add({ table: name, line: block.line, message: `Unknown table setting '${setting.text}'` });
    } else if (setting.key == "note") {
      comment = cleanNote(setting.value);
    }
  }

  for (const item of block.items) {
    const parsed = parseTableContent(item);

    if (parsed.kind == "note") {
      comment = cleanNote(parsed.value);
    } else {
      columnLines.push(parsed);
    }
  }

  for (const nested of block.blocks) {
    const nestedDefinition = parseDefinitionType(nested, collector);

    if (!nestedDefinition) {
      continue;
    }

    if (nestedDefinition.type == "indexes") {
      indexLines = indexLines.concat(nested.items.map(parseIndexesContent));
    } else if (nestedDefinition.type == "Note") {
      comment = convertNote(nested);
    } else {
      collector.add({ table: name, line: nested.line, message: `'${nested.header}' is not allowed inside a Table` });
    }
  }

  const seen = new Set();
  for (const { name: column, line } of columnLines) {
    seen.has(column) && collector.add({ table: name, column, line, message: "Duplicate column" });
    seen.add(column);
  }

  if (columnLines.length == 0) {
    collector.add({ table: name, line: block.line, message: "Table has no columns" });
  }

  const { columns, rawRefs } = convertAttributes(name, columnLines, collector);
  const { indexes, primaryKeys } = convertIndexes(name, columns, indexLines, collector);

  if (primaryKeys.length) {
    const hasColumnPk = columns.some((column) => column.primaryKey);

    if (hasColumnPk || primaryKeys.length > 1) {
      collector.add({
        table: name,
        line: primaryKeys[0].line,
        message: `Table '${name}' declares its primary key twice`,
      });
    } else {
      for (const field of primaryKeys[0].fields) {
        columns.find((column) => column.name == field).primaryKey = true;
      }
    }
  }

  return {
    table: { name, comment, columns, indexes, line: block.line },
    rawRefs,
    patchEdits: columnLines.flatMap((columnLine) => columnLineEdits(name, columnLine)),
  };
}

/**
 * Parses DBML text into the schema description (see
 * specs/001-dbml-to-migration/data-model.md):
 * { tables, relationships, patchEdits }.
 * Throws one DbmlError listing every problem found.
 */
module.exports = function parseSchema(text) {
  const collector = createCollector();
  const { blocks, topLevel } = grouping(String(text), collector);
  const tables = [];
  let patchEdits = noteBlockEdits(blocks);
  let rawRefs = [];

  for (const block of blocks) {
    const definition = parseDefinitionType(block, collector);

    if (!definition) {
      continue;
    }

    if (definition.type == "Table") {
      if (tables.some((table) => table.name == definition.name)) {
        collector.add({ table: definition.name, line: block.line, message: "Duplicate table" });
        continue;
      }

      const parsed = parseTable(block, definition, collector);
      tables.push(parsed.table);
      rawRefs = rawRefs.concat(parsed.rawRefs);
      patchEdits = patchEdits.concat(parsed.patchEdits);
    } else if (definition.type == "Ref") {
      for (const item of block.items) {
        const ref = parseRefLine(item, collector, { inBlock: true });
        ref && rawRefs.push(ref);
      }
    } else if (definition.type != "Project" && definition.type != "TableGroup") {
      collector.add({ line: block.line, message: `'${block.header}' must be inside a Table` });
    }
  }

  for (const item of topLevel) {
    if (/^ref\b/i.test(item.text)) {
      const ref = parseRefLine(item, collector);
      ref && rawRefs.push(ref);
    } else {
      collector.add({ line: item.line, message: `Unexpected line '${item.text}'` });
    }
  }

  const relationships = resolveRelationships(rawRefs, tables, collector);

  collector.throwIfAny();

  patchEdits.sort((a, b) => a.line - b.line);

  return { tables, relationships, patchEdits };
};
