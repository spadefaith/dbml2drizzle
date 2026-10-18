const parseSettings = require("../utils/parse-settings");
const parseDefinitionType = require("./parse-definition-type");
const { findSettingsStart } = require("./parse-table-content");
const convertNote = require("../converter/convert-note");
const { cleanNote } = convertNote;
const { TYPES } = require("../converter/resolve-type");

const VALUE_SETTINGS = ["note"];

/**
 * `text` as a single-quoted DBML string, on one line.
 */
const quoted = (text) => `'${text.replace(/\s*\r?\n\s*/g, " ").replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/**
 * Patch edit for `db-patch.dbml`, which rejects a note on an Enum: the
 * enum's note moves onto its first value, ahead of that value's own note
 * (`'<enum note> (<value note>)'`). Other settings and the trailing comment
 * are kept.
 */
function firstValueEdit({ item, settingsIndex }, enumNote) {
  const { raw, line, commentIndex } = item;
  const codeEnd = commentIndex > -1 ? commentIndex : raw.length;
  const codeRaw = raw.substring(0, codeEnd).replace(/\s+$/, "");
  const trailing = raw.substring(codeRaw.length);
  const indent = raw.match(/^\s*/)[0];
  const target = (settingsIndex > -1 ? item.text.substring(0, settingsIndex) : item.text).trim();
  const settings = settingsIndex > -1 ? parseSettings(item.text.substring(settingsIndex)) : [];
  const own = settings.find((setting) => setting.key == "note");
  const text = own ? `${enumNote} (${cleanNote(own.value)})` : enumNote;
  const texts = settings.map((setting) => (setting == own ? `note: ${quoted(text)}` : setting.text));

  own || texts.push(`note: ${quoted(text)}`);

  return { line, replacement: `${indent}${target} [${texts.join(", ")}]${trailing}` };
}

/**
 * Parses a top-level `Enum name { ... }` block into data-model.md Enum:
 * { name, values: [{ value, note? }], note?, line }. Each line is a value
 * (bare or "double-quoted"), optionally followed by `[note: '...']`, or a
 * `Note: '...'` line; a nested `Note { }` block is the enum's note too.
 * Problems are reported to `collector`. `patchEdits` remove those notes from
 * `db-patch.dbml`, since standard DBML has no note on an Enum.
 */
module.exports = function parseEnum(block, definition, collector) {
  const { name } = definition;
  const location = { line: block.line };
  const values = [];
  const patchEdits = [];
  let note;
  let firstValue;
  const removeLines = (from, to) => {
    for (let line = from; line <= to; line++) patchEdits.push({ line, remove: true });
  };

  if (name.includes(".")) {
    collector.add({ ...location, message: `Schema-qualified enum names are not supported: '${name}'` });
  } else if (TYPES[name.toLowerCase()]) {
    collector.add({ ...location, message: `Enum '${name}' has the name of a built-in type` });
  }

  for (const item of block.items) {
    if (/^note\s*:/i.test(item.text)) {
      note = cleanNote(item.text.substring(item.text.indexOf(":") + 1));
      removeLines(item.line, item.line + item.raw.split(/\r?\n/).length - 1);
      continue;
    }

    const settingsIndex = findSettingsStart(item.text);
    const value = cleanNote(settingsIndex > -1 ? item.text.substring(0, settingsIndex) : item.text);
    const entry = { value };

    for (const setting of settingsIndex > -1 ? parseSettings(item.text.substring(settingsIndex)) : []) {
      VALUE_SETTINGS.includes(setting.key)
        ? (entry.note = cleanNote(setting.value))
        : collector.add({ line: item.line, message: `Unknown enum value setting '${setting.text}'` });
    }

    if (values.some((existing) => existing.value == value)) {
      collector.add({ line: item.line, message: `Duplicate value '${value}' in enum '${name}'` });
      continue;
    }

    values.length == 0 && (firstValue = { item, value, settingsIndex });
    values.push(entry);
  }

  for (const nested of block.blocks) {
    const nestedDefinition = parseDefinitionType(nested, collector);

    if (nestedDefinition && nestedDefinition.type == "Note") {
      note = convertNote(nested);
      removeLines(nested.line, nested.endLine || nested.line);
    } else if (nestedDefinition) {
      collector.add({ line: nested.line, message: `'${nested.header}' is not allowed inside an Enum` });
    }
  }

  note && firstValue && patchEdits.push(firstValueEdit(firstValue, note));

  if (values.length == 0) {
    collector.add({ ...location, message: `Enum '${name}' has no values` });
  }

  return { enum: { name, values, ...(note && { note }), line: block.line }, patchEdits };
};
