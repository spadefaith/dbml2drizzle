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
const convertChecks = /** @type {typeof import("./converter/convert-checks") & { expressionOf: (value: string) => string | null }} */ (require("./converter/convert-checks"));
const convertNote = /** @type {typeof import("./converter/convert-note") & { cleanNote: (text: string) => string }} */ (require("./converter/convert-note"));
const resolveRelationships = require("./converter/resolve-relationships");
const parseRefLine = require("./parser/parse-ref-line");
const parseEnum = require("./parser/parse-enum");
const { cleanNote } = convertNote;
const { expressionOf } = convertChecks;
const { RENAMED_FROM_MESSAGE } = convertAttributes;

/** @typedef {import("./types").Block} Block */
/** @typedef {import("./types").Column} Column */
/** @typedef {import("./types").ColumnLine} ColumnLine */
/** @typedef {import("./types").Enum} Enum */
/** @typedef {import("./types").PatchEdit} PatchEdit */
/** @typedef {import("./types").RawRef} RawRef */

const TABLE_SETTINGS = ["note", "headercolor"];

// defaults resolveDefault treats as SQL; standard DBML needs them in backticks
const SQL_DEFAULT = /^(now\(\)|CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME)$/i;

/** @param {{ text: string }[]} settings */
const settingsText = (settings) =>
  settings.length ? ` [${settings.map((setting) => setting.text).join(", ")}]` : "";

/**
 * A table or column name for a `Ref:` line: quoted unless it is a plain identifier.
 *
 * @param {string} name
 */
const refName = (name) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `"${name}"`);

/**
 * `table.column` or `"order items".column` without quotes, to compare reference sides.
 *
 * @param {string} text
 */
const plainSide = (text) => text.trim().replace(/"/g, "");

/**
 * A relationship side as `table.column` or `table.(a, b)`.
 *
 * @param {{ table: string, columns: string[] }} side
 */
const sideName = ({ table, columns }) =>
  columns.length == 1 ? `${table}.${columns[0]}` : `${table}.(${columns.join(", ")})`;

/**
 * Patch edits for one column line that standard DBML rejects (see
 * data-model.md PatchEdit and specs/013 research R1–R5):
 *
 * - an inline ref with delete:/update: becomes a standalone `Ref:` line with
 *   the direction as written, its names quoted where needed;
 * - an inline ref that repeats an earlier declaration (`dropped`) is removed,
 *   together with its actions when no other ref stays on the line;
 * - an unquoted `now()` / `CURRENT_*` default is written in backticks;
 * - a `check:` whose expression holds a backtick becomes a `//` comment.
 *
 * The line keeps its other settings and its trailing comment, and gets at
 * most one replacement. A line that needs none of these is left unchanged.
 *
 * @param {string} table
 * @param {ColumnLine} columnLine
 * @param {Set<string>[]} dropped the sides (`table.column`) of each reference
 *   declared on this line that an earlier declaration already covers
 * @returns {PatchEdit[]}
 */
function columnLineEdits(table, columnLine, dropped) {
  const { name, settings, head, trailing, line } = columnLine;
  const actions = settings.filter((setting) => setting.key == "delete" || setting.key == "update");
  const refs = settings.filter((setting) => setting.key == "ref");
  // convertAttributes has already rejected refs that do not match
  /** @param {import("./types").Setting} ref */
  const parts = (ref) => /** @type {RegExpMatchArray} */ (String(ref.value).trim().match(/^(<>|>|<|-)\s*(.+)$/s));
  /** @param {import("./types").Setting} ref */
  const isDropped = (ref) => dropped.some((sides) => sides.has(plainSide(parts(ref)[2])));
  const keptRefs = refs.filter((ref) => !isDropped(ref));
  const moving = actions.length > 0 && refs.length > 0;

  /** @type {{ text: string }[]} */
  const kept = [];
  const comments = [];
  let changed = false;

  for (const setting of settings) {
    const value = String(setting.value).trim();
    const expression = setting.key == "check" ? expressionOf(value) : null;

    if (setting.key == "ref" && (moving || isDropped(setting))) {
      changed = true;
    } else if ((setting.key == "delete" || setting.key == "update") && moving) {
      changed = true;
    } else if (setting.key == "default" && SQL_DEFAULT.test(value)) {
      kept.push({ text: `default: \`${value}\`` });
      changed = true;
    } else if (expression && expression.includes("`")) {
      comments.push(`// check ${table}_${name}_check: ${value}`);
      changed = true;
    } else {
      kept.push(setting);
    }
  }

  if (!changed) {
    return [];
  }

  const comment = trailing.replace(/\s+$/, "");
  const ending = comments.length ? `${comment.trim() ? comment : ""} ${comments.join(" ")}` : trailing;
  /** @type {PatchEdit[]} */
  const edits = [{ line, replacement: `${head}${settingsText(kept)}${ending}` }];

  if (moving) {
    const actionText = actions.map((setting) => `${setting.key}: ${setting.value}`).join(", ");

    for (const ref of keptRefs) {
      const [, op, target] = parts(ref);
      edits.push({ line, appendRef: `Ref: ${refName(table)}.${refName(name)} ${op} ${target.trim()} [${actionText}]` });
    }
  }

  return edits;
}

/**
 * Patch edits for references declared more than once with the same
 * endpoints: standard DBML rejects the repeats. The declaration read first
 * (`declaredAt[0]`) is kept; a repeated standalone `Ref:` line or `Ref { }`
 * entry is removed, and a `Ref { }` block left empty is removed whole.
 * Repeated inline declarations are returned in `droppedInline` (by line) for
 * columnLineEdits. See specs/013 research R3.
 *
 * @param {import("./types").Relationship[]} relationships
 * @param {Block[]} refBlocks the top-level `Ref { }` blocks
 * @returns {{ edits: PatchEdit[], droppedInline: Map<number, Set<string>[]> }}
 */
function duplicateRefEdits(relationships, refBlocks) {
  /** @type {Map<number, Set<string>[]>} */
  const droppedInline = new Map();
  /** @type {Set<number>} */
  const removed = new Set();

  for (const relationship of relationships) {
    const sides = new Set([sideName(relationship.from), sideName(relationship.to)]);

    for (const { line, form } of relationship.declaredAt.slice(1)) {
      form == "inline"
        ? droppedInline.set(line, [...(droppedInline.get(line) || []), sides])
        : removed.add(line);
    }
  }

  const edits = [...removed].map((line) => ({ line, remove: true }));

  for (const block of refBlocks) {
    if (block.items.length && block.items.every((item) => removed.has(item.line))) {
      for (let line = block.line; line <= /** @type {number} */ (block.endLine); line++) {
        removed.has(line) || edits.push({ line, remove: true });
      }
    }
  }

  return { edits, droppedInline };
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

  const { checks, patchEdits: checkEdits } = convertChecks(name, columnChecks, checkLines || [], collector);

  // column-line edits need the resolved relationships, so parseSchema builds them
  return {
    table: { name, comment, columns, indexes, checks, line: block.line },
    rawRefs,
    columnLines,
    patchEdits: [...indexEdits, ...checkEdits],
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
  /** @type {{ table: string, columnLines: ColumnLine[] }[]} */
  const tableColumnLines = [];
  /** @type {Block[]} */
  const refBlocks = [];
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
      tableColumnLines.push({ table: parsed.table.name, columnLines: parsed.columnLines });
    } else if (definition.type == "Ref") {
      refBlocks.push(block);
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

  const { edits: duplicateEdits, droppedInline } = duplicateRefEdits(relationships, refBlocks);
  patchEdits = patchEdits.concat(
    duplicateEdits,
    tableColumnLines.flatMap(({ table, columnLines }) =>
      columnLines.flatMap((columnLine) => columnLineEdits(table, columnLine, droppedInline.get(columnLine.line) || [])))
  );
  patchEdits.sort((a, b) => a.line - b.line);

  return { tables, enums, relationships, patchEdits };
};
