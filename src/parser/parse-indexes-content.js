const parseSettings = require("../utils/parse-settings");
const { splitOutside } = parseSettings;
const { unquote } = require("./parse-definition-type");
const { findSettingsStart } = require("./parse-table-content");
const { expressionOf } = require("../converter/convert-checks");

/**
 * Parses one line inside an `indexes { }` block, e.g. `name`,
 * `(account_id, setting_id) [unique, name: 'x']`, `` `lower(email)` [name: 'y'] ``.
 * Returns { parts, fields, settings, line, indent, target, trailing }:
 * `parts` are the targets in written order, each { column } or { expression }
 * (expression is null when a backtick part is malformed); `fields` are the
 * column names. `indent`, `target` (raw text before the settings) and
 * `trailing` (spaces and a `//` comment) let the line be rebuilt exactly.
 */
module.exports = function parseIndexesContent(item) {
  const { text, raw, line, commentIndex } = item;
  const settingsIndex = findSettingsStart(text);
  const targetText = (settingsIndex > -1 ? text.substring(0, settingsIndex) : text).trim();
  const settings = settingsIndex > -1 ? parseSettings(text.substring(settingsIndex)) : [];

  const inner = targetText.startsWith("(") && targetText.endsWith(")")
    ? targetText.substring(1, targetText.length - 1)
    : targetText;
  const parts = splitOutside(inner, ",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.startsWith("`") ? { expression: expressionOf(part) } : { column: unquote(part) }));

  const codeEnd = commentIndex > -1 ? commentIndex : raw.length;
  const codeRaw = raw.substring(0, codeEnd).replace(/\s+$/, "");

  return {
    parts,
    fields: parts.filter((part) => "column" in part).map((part) => part.column),
    settings,
    line,
    indent: raw.match(/^\s*/)[0],
    target: targetText,
    trailing: raw.substring(codeRaw.length),
  };
};
