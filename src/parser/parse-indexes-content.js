const parseSettings = require("../utils/parse-settings");
const { splitOutside } = parseSettings;
const { unquote } = require("./parse-definition-type");
const { findSettingsStart } = require("./parse-table-content");

/**
 * Parses one line inside an `indexes { }` block, e.g. `name`,
 * `(account_id, setting_id) [unique, name: 'x']`.
 * Returns { fields, expression, settings, line }; `expression` is true when
 * the line indexes an expression (backticks), which is not supported.
 */
module.exports = function parseIndexesContent(item) {
  const { text, line } = item;
  const settingsIndex = findSettingsStart(text);
  const target = (settingsIndex > -1 ? text.substring(0, settingsIndex) : text).trim();
  const settings = settingsIndex > -1 ? parseSettings(text.substring(settingsIndex)) : [];

  const inner = target.startsWith("(") && target.endsWith(")")
    ? target.substring(1, target.length - 1)
    : target;
  const fields = splitOutside(inner, ",")
    .map((field) => field.trim())
    .filter(Boolean);

  return {
    fields: fields.map(unquote),
    expression: fields.some((field) => field.includes("`")),
    settings,
    line,
  };
};
