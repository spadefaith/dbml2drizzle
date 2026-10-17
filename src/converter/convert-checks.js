const { cleanNote } = require("./convert-note");

const CHECK_SETTINGS = ["name"];

/**
 * Text between the backticks of `` `expr` ``, with `` \` `` unescaped, or
 * null when `value` is not a single backtick expression.
 */
function expressionOf(value) {
  const match = String(value).trim().match(/^`((?:[^`\\]|\\.)*)`$/s);
  return match ? match[1].replace(/\\`/g, "`").trim() : null;
}

/**
 * Turns the `check:` settings of one table's columns ([{ column, value, line }])
 * and its parsed `checks { }` lines into data-model.md Checks:
 * { name, expression, column?, line }. Column checks come first, in column
 * order, then table checks in block order.
 */
module.exports = function convertChecks(table, columnChecks, checkLines, collector) {
  const checks = [];
  const counted = new Set();

  for (const { column, value, line } of columnChecks) {
    const location = { table, column, line };

    if (counted.has(column)) {
      collector.add({ ...location, message: "A column takes one check; use a table checks { } block for more" });
      continue;
    }

    counted.add(column);
    const expression = expressionOf(value);

    if (expression === null) {
      collector.add({ ...location, message: "check must be a backtick expression, e.g. check: `price >= 0`" });
    } else if (!expression) {
      collector.add({ ...location, message: "Check expression is empty" });
    } else {
      checks.push({ name: `${table}_${column}_check`, expression, column, line });
    }
  }

  for (const { expression, settings, line } of checkLines) {
    const location = { table, line };
    let name;
    let valid = true;

    for (const setting of settings) {
      if (!CHECK_SETTINGS.includes(setting.key)) {
        collector.add({ ...location, message: `Unknown check setting '${setting.text}'` });
        valid = false;
      } else {
        name = cleanNote(setting.value);
      }
    }

    if (expression === null) {
      collector.add({ ...location, message: "Check must be a backtick expression" });
    } else if (!expression) {
      collector.add({ ...location, message: "Check expression is empty" });
    } else if (!name) {
      collector.add({ ...location, message: "Table checks need a name, e.g. [name: 'orders_total_positive']" });
    } else if (valid) {
      checks.push({ name, expression, line });
    }
  }

  return checks;
};

module.exports.expressionOf = expressionOf;
