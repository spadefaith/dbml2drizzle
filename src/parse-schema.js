// @ts-check
const grouping = require("./utils/grouping");
const parseSettings = require("./utils/parse-settings");
const { createCollector } = require("./errors");

const parseDefinitionType = require("./parser/parse-definition-type");
const parseTableContent = require("./parser/parse-table-content");
const parseIndexesContent = require("./parser/parse-indexes-content");
const parseChecksContent = require("./parser/parse-checks-content");
// the casts add the properties these modules attach to their exported function
const convertAttributes = /** @type {typeof import("./converter/convert-attributes") & { RENAMED_FROM_MESSAGE: string }} */ (require("./converter/convert-attributes"));
const convertIndexes = require("./converter/convert-indexes");
const convertChecks = require("./converter/convert-checks");
const convertNote = /** @type {typeof import("./converter/convert-note") & { cleanNote: (text: string) => string }} */ (require("./converter/convert-note"));
const resolveRelationships = require("./converter/resolve-relationships");
const parseRefLine = require("./parser/parse-ref-line");
const parseEnum = require("./parser/parse-enum");
const { cleanNote } = convertNote;
const { RENAMED_FROM_MESSAGE } = convertAttributes;

/** @typedef {import("./types").Block} Block */
/** @typedef {import("./types").Column} Column */
/** @typedef {import("./types").ColumnLine} ColumnLine */
/** @typedef {import("./types").Enum} Enum */
/** @typedef {import("./types").PatchEdit} PatchEdit */
/** @typedef {import("./types").RawRef} RawRef */

const TABLE_SETTINGS = ["note", "headercolor"];
const MOVED_SETTINGS = ["ref", "delete", "update"];

/** @param {import("./types").Setting[]} settings */
const settingsText = (settings) =>
  settings.length ? ` [${settings.map((setting) => setting.text).join(", ")}]` : "";

/**
 * Patch edits for one column line that standard DBML rejects: an inline
 * ref with delete:/update: becomes a standalone `Ref:` line with the
 * direction as written. The line keeps its other settings and its
 * trailing comment, and gets a single replacement (see data-model.md
 * PatchEdit).
 *
 * @param {string} table
 * @param {ColumnLine} columnLine
 * @returns {PatchEdit[]}
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
    // convertAttributes has already rejected refs that do not match
    const [, op, target] = /** @type {RegExpMatchArray} */ (String(ref.value).trim().match(/^(<>|>|<|-)\s*(.+)$/s));
    /** @type {PatchEdit} */
    const edit = { line, appendRef: `Ref: ${table}.${name} ${op} ${target.trim()} [${actionText}]` };
    index == 0 && (edit.replacement = replacement);
    return edit;
  });
}

/**
 * Patch edits for every `Note: {` block, at any depth: `Note {`.
 *
 * @param {Block[]} blocks
 * @returns {PatchEdit[]}
 */
function noteBlockEdits(blocks) {
  return blocks.flatMap((block) => [
    ...(/^note\s*:$/i.test(block.header)
      ? [{ line: block.line, replacement: block.raw.replace(/(note)\s*:\s*\{/i, "$1 {") }]
      : []),
    ...noteBlockEdits(block.blocks),
  ]);
}

/**
 * One `Table` block: its table, its inline references and its patch edits.
 *
 * @param {Block} block
 * @param {import("./types").Definition} definition
 * @param {import("./types").Collector} collector
 * @param {Map<string, Enum>} enums
 */
function parseTable(block, definition, collector, enums) {
  const name = definition.name;
  /** @type {ColumnLine[]} */
  const columnLines = [];
  let comment = "";
  /** @type {import("./types").IndexLine[]} */
  let indexLines = [];
  /** @type {import("./types").CheckLine[] | null} */
  let checkLines = null;

  for (const setting of definition.settings ? parseSettings(definition.settings) : []) {
    if (setting.key == "renamed_from") {
      collector.add({ table: name, line: block.line, message: RENAMED_FROM_MESSAGE });
    } else if (!TABLE_SETTINGS.includes(setting.key)) {
      collector.add({ table: name, line: block.line, message: `Unknown table setting '${setting.text}'` });
    } else if (setting.key == "note") {
      comment = cleanNote(/** @type {string} */ (setting.value));
    }
  }

  for (const item of block.items) {
    const parsed = /** @type {import("./types").NoteLine | ColumnLine} */ (parseTableContent(item));

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
    } else if (nestedDefinition.type == "checks") {
      checkLines
        ? collector.add({ table: name, line: nested.line, message: `Table '${name}' has more than one checks block` })
        : (checkLines = nested.items.map(parseChecksContent));
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

  // columns with an invalid type are kept for reference checks; their error stops parsing
  const { columns, rawRefs, columnChecks } = /** @type {{ columns: Column[], rawRefs: RawRef[], columnChecks: { column: string, value: string, line: number }[] }} */ (convertAttributes(name, columnLines, collector, enums));
  const { indexes, primaryKeys, patchEdits: indexEdits } = convertIndexes(name, columns, indexLines, collector);

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
        /** @type {Column} */ (columns.find((column) => column.name == field)).primaryKey = true;
      }
    }
  }

  const checks = convertChecks(name, columnChecks, checkLines || [], collector);

  return {
    table: { name, comment, columns, indexes, checks, line: block.line },
    rawRefs,
    patchEdits: [...columnLines.flatMap((columnLine) => columnLineEdits(name, columnLine)), ...indexEdits],
  };
}

/**
 * Parses DBML text into the schema description (see
 * specs/001-dbml-to-migration/data-model.md):
 * { tables, enums, relationships, patchEdits }.
 * Throws one DbmlError listing every problem found.
 *
 * @param {string} text
 * @returns {import("./types").Schema}
 */
module.exports = function parseSchema(text) {
  const collector = createCollector();
  const { blocks, topLevel } = /** @type {{ blocks: Block[], topLevel: import("./types").Item[] }} */ (grouping(String(text), collector));
  /** @type {import("./types").Table[]} */
  const tables = [];
  let patchEdits = noteBlockEdits(blocks);
  /** @type {RawRef[]} */
  let rawRefs = [];
  /** @type {Enum[]} */
  const enums = [];
  /** @type {Map<string, Enum>} */
  const enumsByName = new Map();
  const definitions = new Map(blocks.map((block) => [block, parseDefinitionType(block, collector)]));

  // Enum blocks first, so columns can use an enum declared later in the file
  for (const block of blocks) {
    const definition = definitions.get(block);

    if (!definition || definition.type != "Enum") {
      continue;
    }

    const { enum: parsed, patchEdits: enumEdits } = parseEnum(block, definition, collector);
    patchEdits = patchEdits.concat(enumEdits);
    const first = enumsByName.get(parsed.name);

    if (first) {
      collector.add({ line: block.line, message: `Duplicate enum '${parsed.name}' (also on line ${first.line})` });
      continue;
    }

    enums.push(parsed);
    enumsByName.set(parsed.name, parsed);
  }

  for (const block of blocks) {
    const definition = definitions.get(block);

    if (!definition || definition.type == "Enum") {
      continue;
    }

    if (definition.type == "Table") {
      if (tables.some((table) => table.name == definition.name)) {
        collector.add({ table: definition.name, line: block.line, message: "Duplicate table" });
        continue;
      }

      const parsed = parseTable(block, definition, collector, enumsByName);
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

  for (const { name, line } of enums) {
    const table = tables.find((item) => item.name == name);
    table && collector.add({ line, message: `Enum '${name}' has the same name as table '${name}' (line ${table.line})` });
  }
  const checkLinesByName = new Map();

  for (const { name: table, checks } of tables) {
    for (const check of checks) {
      const first = checkLinesByName.get(check.name);
      first == undefined
        ? checkLinesByName.set(check.name, check.line)
        : collector.add({ table, line: check.line, message: `Duplicate check name '${check.name}' (also on line ${first})` });
    }
  }

  collector.throwIfAny();

  patchEdits.sort((a, b) => a.line - b.line);

  return { tables, enums, relationships, patchEdits };
};
