const parseSettings = require("../utils/parse-settings");
const { findSettingsStart } = require("./parse-table-content");
const { expressionOf } = require("../converter/convert-checks");

/**
 * Parses one line inside a `checks { }` block, e.g.
 * `` `ends_at > starts_at` [name: 'events_valid_range'] ``.
 * Returns { expression, settings, line }; `expression` is null when the line
 * is not a single backtick expression.
 */
module.exports = function parseChecksContent(item) {
  const { text, line } = item;
  const settingsIndex = findSettingsStart(text);
  const target = (settingsIndex > -1 ? text.substring(0, settingsIndex) : text).trim();
  const settings = settingsIndex > -1 ? parseSettings(text.substring(settingsIndex)) : [];

  return { expression: expressionOf(target), settings, line };
};
