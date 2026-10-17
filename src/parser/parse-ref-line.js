const parseSettings = require("../utils/parse-settings");
const { unquote } = require("./parse-definition-type");
const { findSettingsStart } = require("./parse-table-content");

const REF_SETTINGS = ["delete", "update", "color"];

/**
 * Parses one side of a reference: `table.column` or `table.(a, b)`.
 */
function parseSide(text) {
  const match = text.trim().match(/^("[^"]+"|[^\s.()]+)\.(\(([^)]*)\)|"[^"]+"|[^\s.()]+)$/);

  if (!match) {
    return null;
  }

  const columns = match[3] != undefined
    ? match[3].split(",").map((column) => unquote(column.trim()))
    : [unquote(match[2])];

  return columns.every(Boolean) ? { table: unquote(match[1]), columns } : null;
}

/**
 * Parses a standalone reference: `Ref: a.b > c.d [delete: cascade]`,
 * `Ref name: …`, or (inside a `Ref { }` block, `inBlock`) `a.b > c.d`.
 * Composite sides are written `a.(x, y)`. Returns a raw reference
 * { from, op, to, onDelete, onUpdate, line, form: "standalone" } or null
 * after reporting the problem.
 */
module.exports = function parseRefLine(item, collector, { inBlock = false } = {}) {
  const { line } = item;
  let body = item.text.trim();

  if (!inBlock) {
    const prefix = body.match(/^ref\b\s*("[^"]*"|[^\s:]+)?\s*:/i);

    if (!prefix) {
      collector.add({ line, message: `Malformed reference '${body}'` });
      return null;
    }

    body = body.substring(prefix[0].length).trim();
  }

  const settingsStart = findSettingsStart(body);
  const settings = settingsStart > -1 ? parseSettings(body.substring(settingsStart)) : [];
  const relation = (settingsStart > -1 ? body.substring(0, settingsStart) : body).trim();
  const match = relation.match(/^(.+?)\s*(<>|>|<|-)\s*(.+)$/s);
  const from = match && parseSide(match[1]);
  const to = match && parseSide(match[3]);

  if (!from || !to) {
    collector.add({ line, message: `Malformed reference '${relation}'` });
    return null;
  }

  const location = { table: from.table, column: from.columns.join(", "), line };

  if (match[2] == "<>") {
    collector.add({ ...location, message: "Many-to-many references (<>) are not supported" });
    return null;
  }

  const ref = { from, op: match[2], to, line, form: "standalone" };

  for (const setting of settings) {
    if (!REF_SETTINGS.includes(setting.key)) {
      collector.add({ ...location, message: `Unknown reference setting '${setting.text}'` });
    } else if (setting.key == "delete") {
      ref.onDelete = String(setting.value).toUpperCase();
    } else if (setting.key == "update") {
      ref.onUpdate = String(setting.value).toUpperCase();
    }
  }

  return ref;
};
