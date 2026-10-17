const BLOCK_TYPES = ["Table", "Project", "TableGroup", "Ref", "indexes", "Note"];

function unquote(name) {
  return name.replace(/^"(.*)"$/, "$1");
}

/**
 * Identifies a block from its header, e.g. "Table users [note: 'x']",
 * "Note:", "indexes", "Ref fk_name". Returns { type, name, settings } or null
 * after reporting the problem.
 */
module.exports = function parseDefinitionType(block, collector) {
  const header = block.header;
  const match = header.match(/^(\w+):?\s*(.*)$/s);
  const word = match ? match[1] : header;

  if (/^enum$/i.test(word)) {
    collector.add({
      message: "Enum blocks are not supported; use an inline enum('a','b') type",
      line: block.line,
    });
    return null;
  }

  const type = BLOCK_TYPES.find((name) => name.toLowerCase() == word.toLowerCase());

  if (!type) {
    collector.add({ message: `Unknown block '${word}'`, line: block.line });
    return null;
  }

  let rest = match[2].trim();
  let settings = "";
  const settingsIndex = rest.indexOf("[");

  if (settingsIndex > -1 && rest.endsWith("]")) {
    settings = rest.substring(settingsIndex);
    rest = rest.substring(0, settingsIndex).trim();
  }

  // "Table users as U" -> "users"
  const name = unquote(rest.split(/\s+as\s+/i)[0].trim());

  if (type == "Table" && !name) {
    collector.add({ message: "Table is missing its name", line: block.line });
    return null;
  }

  return { type, name, settings };
};

module.exports.unquote = unquote;
