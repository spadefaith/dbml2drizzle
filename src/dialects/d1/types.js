const checkIncrement = require("./increment");

/**
 * Cloudflare D1 (SQLite) column builders (drizzle-orm/sqlite-core) for the
 * canonical DBML types. Each entry returns [builder, options text or ""].
 * Lengths are kept as written although SQLite does not enforce them;
 * decimals and date/time values are stored as text.
 */
const lengthOption = (args) => (args.length ? `{ length: ${args[0]} }` : "");

const TYPES = {
  varchar: (args) => ["text", lengthOption(args)],
  char: (args) => ["text", lengthOption(args)],
  text: () => ["text", ""],
  integer: () => ["integer", ""],
  smallint: () => ["integer", ""],
  bigint: () => ["integer", '{ mode: "number" }'],
  decimal: () => ["text", ""],
  float: () => ["real", ""],
  double: () => ["real", ""],
  real: () => ["real", ""],
  boolean: () => ["integer", '{ mode: "boolean" }'],
  timestamp: () => ["text", ""],
  timestamptz: () => ["text", ""],
  date: () => ["text", ""],
  time: () => ["text", ""],
  json: () => ["text", '{ mode: "json" }'],
  jsonb: () => ["text", '{ mode: "json" }'],
  uuid: () => ["text", ""],
};

/**
 * Returns { builders, text } for one non-enum column, e.g.
 * { builders: ["text"], text: 'text("name", { length: 100 })' }, or
 * null after reporting the problem to `collector`. A valid `increment` is
 * written by the dialect's primaryKeyModifier.
 */
module.exports = function columnCall(column, location, collector, table) {
  const { type } = column;
  const toBuilder = TYPES[type.name];

  if (!toBuilder) {
    collector.add({ ...location, message: `Type '${type.name}' has no D1 mapping` });
    return null;
  }

  if (!checkIncrement(column, location, collector, table)) {
    return null;
  }

  const [builder, options] = toBuilder(type.args);
  const text = `${builder}(${[JSON.stringify(column.name), options].filter(Boolean).join(", ")})`;

  return { builders: [builder], text };
};
