const pgDefaultModifier = require("../pg/defaults");

const CURRENT = /^(CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME)$/i;

/**
 * Default modifier for a column default (see converter/resolve-default.js):
 * { text, usesSql }. `now()` becomes the current date-time text; it and the
 * CURRENT_* keywords are parenthesized, as SQLite requires for expression
 * defaults. Other expressions and values are written as for PostgreSQL.
 */
module.exports = function defaultModifier(defaultValue) {
  const { kind, value } = defaultValue;

  if (kind == "fn" && value == "now") {
    return { text: ".default(sql`(CURRENT_TIMESTAMP)`)", usesSql: true };
  }

  if (kind == "literal" && CURRENT.test(value)) {
    return { text: `.default(sql\`(${value})\`)`, usesSql: true };
  }

  return pgDefaultModifier(defaultValue);
};
