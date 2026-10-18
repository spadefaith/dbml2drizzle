const parseSettings = require("../utils/parse-settings");
const parseDefinitionType = require("./parse-definition-type");
const { findSettingsStart } = require("./parse-table-content");
const convertNote = require("../converter/convert-note");
const { cleanNote } = convertNote;
const { TYPES } = require("../converter/resolve-type");

const VALUE_SETTINGS = ["note"];

/**
 * Parses a top-level `Enum name { ... }` block into data-model.md Enum:
 * { name, values: [{ value, note? }], note?, line }. Each line is a value
 * (bare or "double-quoted"), optionally followed by `[note: '...']`, or a
 * `Note: '...'` line; a nested `Note { }` block is the enum's note too.
 * Problems are reported to `collector`.
 */
module.exports = function parseEnum(block, definition, collector) {
  const { name } = definition;
  const location = { line: block.line };
  const values = [];
  let note;

  if (name.includes(".")) {
    collector.add({ ...location, message: `Schema-qualified enum names are not supported: '${name}'` });
  } else if (TYPES[name.toLowerCase()]) {
    collector.add({ ...location, message: `Enum '${name}' has the name of a built-in type` });
  }

  for (const item of block.items) {
    if (/^note\s*:/i.test(item.text)) {
      note = cleanNote(item.text.substring(item.text.indexOf(":") + 1));
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

    values.push(entry);
  }

  for (const nested of block.blocks) {
    const nestedDefinition = parseDefinitionType(nested, collector);

    if (nestedDefinition && nestedDefinition.type == "Note") {
      note = convertNote(nested);
    } else if (nestedDefinition) {
      collector.add({ line: nested.line, message: `'${nested.header}' is not allowed inside an Enum` });
    }
  }

  if (values.length == 0) {
    collector.add({ ...location, message: `Enum '${name}' has no values` });
  }

  return { name, values, ...(note && { note }), line: block.line };
};
