const parseSettings = require("../utils/parse-settings");
const { unquote } = require("./parse-definition-type");

/**
 * Finds the settings list "[...]" that ends a column line: the last bracket
 * group outside quotes that closes at the end of `code`. Returns its start
 * index or -1. Brackets earlier in the line (e.g. `int[]`) are not settings.
 */
function findSettingsStart(code) {
  if (!code.endsWith("]")) {
    return -1;
  }

  let quote = null;
  let depth = 0;
  let start = -1;

  for (let i = 0; i < code.length; i++) {
    const c = code[i];

    if (quote) {
      c == "\\" ? i++ : c == quote && (quote = null);
    } else if (c == "'" || c == '"' || c == "`") {
      quote = c;
    } else if (c == "[") {
      depth == 0 && (start = i);
      depth++;
    } else if (c == "]") {
      depth--;
    }
  }

  return depth == 0 ? start : -1;
}

/**
 * Parses one line inside a Table block.
 *
 * - `Note: '...'` → { kind: "note", value, line }
 * - a column → { kind: "column", name, typeRaw, settings, line, raw,
 *   indent, head, trailing } where `head` is the raw text before the
 *   settings list (no trailing spaces) and `trailing` is everything after the
 *   code (spaces and a `//` comment), so the line can be rebuilt exactly.
 */
module.exports = function parseTableContent(item) {
  const { text, raw, line, commentIndex } = item;

  if (/^note\s*:/i.test(text)) {
    return { kind: "note", value: text.substring(text.indexOf(":") + 1).trim(), line };
  }

  const codeEnd = commentIndex > -1 ? commentIndex : raw.length;
  const codeRaw = raw.substring(0, codeEnd).replace(/\s+$/, "");
  const indent = raw.match(/^\s*/)[0];
  const settingsStart = findSettingsStart(codeRaw);

  const head = (settingsStart > -1 ? codeRaw.substring(0, settingsStart) : codeRaw).replace(/\s+$/, "");
  const settingsText = settingsStart > -1 ? codeRaw.substring(settingsStart) : "";
  const trailing = raw.substring(codeRaw.length);

  const headText = head.trim();
  const nameMatch = headText.match(/^("[^"]+"|\S+)\s*(.*)$/s);

  return {
    kind: "column",
    name: unquote(nameMatch[1]),
    typeRaw: nameMatch[2].trim(),
    settings: settingsText ? parseSettings(settingsText) : [],
    line,
    raw,
    indent,
    head,
    trailing,
  };
};

module.exports.findSettingsStart = findSettingsStart;
