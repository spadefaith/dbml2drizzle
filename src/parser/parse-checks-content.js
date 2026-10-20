const parseSettings = require("../utils/parse-settings");
const { findSettingsStart } = require("./parse-table-content");
const { expressionOf } = require("../converter/convert-checks");

/**
 * Parses one line inside a `checks { }` block, e.g.
 * `` `ends_at > starts_at` [name: 'events_valid_range'] ``.
 * Returns { expression, settings, line, indent, target, trailing };
 * `expression` is null when the line is not a single backtick expression.
 * `indent`, `target` (raw text before the settings) and `trailing` (spaces
 * and a `//` comment) let the line be rebuilt exactly.
 */
module.exports = function parseChecksContent(item) {
  const { text, raw, line, commentIndex } = item;
  const settingsIndex = findSettingsStart(text);
  const target = (settingsIndex > -1 ? text.substring(0, settingsIndex) : text).trim();
  const settings = settingsIndex > -1 ? parseSettings(text.substring(settingsIndex)) : [];

  const codeEnd = commentIndex > -1 ? commentIndex : raw.length;
  const codeRaw = raw.substring(0, codeEnd).replace(/\s+$/, "");

  return {
    expression: expressionOf(target),
    settings,
    line,
    indent: raw.match(/^\s*/)[0],
    target,
    trailing: raw.substring(codeRaw.length),
  };
};
