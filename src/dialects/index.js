const pg = require("./pg");
const d1 = require("./d1");

const registry = { pg, d1 };

/**
 * Registered target dialect ids.
 */
const dialects = Object.keys(registry);

function getDialect(id = "pg") {
  const dialect = registry[id];

  if (!dialect) {
    throw new Error(`Unsupported dialect '${id}'. Supported: ${dialects.join(", ")}`);
  }

  return dialect;
}

module.exports = { dialects, getDialect };
