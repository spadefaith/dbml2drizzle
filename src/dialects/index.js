// @ts-check
const pg = require("./pg");
const sqlite = require("./sqlite");

const registry = { pg, sqlite };

/**
 * A registered target dialect id: "pg" | "sqlite".
 *
 * @typedef {keyof typeof registry} DialectId
 */

/**
 * Registered target dialect ids.
 */
const dialects = /** @type {DialectId[]} */ (Object.keys(registry));

/**
 * The dialect registered as `id`; throws for an unsupported id.
 *
 * @param {string} [id]
 * @returns {import("../types").Dialect}
 */
function getDialect(id = "pg") {
  const dialect = registry[/** @type {DialectId} */ (id)];

  if (!dialect) {
    throw new Error(`Unsupported dialect '${id}'. Supported: ${dialects.join(", ")}`);
  }

  return dialect;
}

module.exports = { dialects, getDialect };
