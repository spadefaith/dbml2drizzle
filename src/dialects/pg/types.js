/**
 * PostgreSQL column builders (drizzle-orm/pg-core) for the canonical DBML
 * types. Each entry returns [builder, options text or ""].
 */
const lengthOption = (args) => (args.length ? `{ length: ${args[0]} }` : "");

const TYPES = {
  varchar: (args) => ["varchar", lengthOption(args)],
  char: (args) => ["char", lengthOption(args)],
  text: () => ["text", ""],
  integer: () => ["integer", ""],
  smallint: () => ["smallint", ""],
  bigint: () => ["bigint", '{ mode: "number" }'],
  decimal: (args) => [
    "numeric",
    args.length
      ? `{ ${[`precision: ${args[0]}`, args.length > 1 && `scale: ${args[1]}`].filter(Boolean).join(", ")} }`
      : "",
  ],
  float: () => ["doublePrecision", ""],
  double: () => ["doublePrecision", ""],
  real: () => ["real", ""],
  boolean: () => ["boolean", ""],
  timestamp: () => ["timestamp", ""],
  timestamptz: () => ["timestamp", "{ withTimezone: true }"],
  date: () => ["date", ""],
  time: () => ["time", ""],
  json: () => ["json", ""],
  jsonb: () => ["jsonb", ""],
  uuid: () => ["uuid", ""],
};

const IDENTITY_TYPES = ["integer", "bigint", "smallint"];

/**
 * Returns { builders, text } for one non-enum column, e.g.
 * { builders: ["varchar"], text: 'varchar("name", { length: 100 })' }, or
 * null after reporting the problem to `collector`.
 */
module.exports = function columnCall(column, location, collector) {
  const { type } = column;
  const toBuilder = TYPES[type.name];

  if (!toBuilder) {
    collector.add({ ...location, message: `Type '${type.name}' has no PostgreSQL mapping` });
    return null;
  }

  const [builder, options] = toBuilder(type.args);
  let text = `${builder}(${[JSON.stringify(column.name), options].filter(Boolean).join(", ")})`;

  if (column.autoIncrement) {
    if (!IDENTITY_TYPES.includes(type.name)) {
      collector.add({ ...location, message: "increment needs integer, bigint or smallint" });
      return null;
    }

    text += ".generatedByDefaultAsIdentity()";
  }

  return { builders: [builder], text };
};
