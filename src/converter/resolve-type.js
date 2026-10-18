/**
 * Resolves a DBML column type, e.g. varchar(100), decimal(18,2) or
 * enum('a','b'), to its canonical DBML name plus its arguments. Aliases are
 * folded (int → integer, string → varchar, ...). The name stays
 * dialect-neutral: each target dialect maps it to its own column builder.
 */
const TYPES = {
  varchar: "varchar",
  string: "varchar",
  char: "char",
  text: "text",
  integer: "integer",
  int: "integer",
  bigint: "bigint",
  smallint: "smallint",
  decimal: "decimal",
  numeric: "decimal",
  float: "float",
  double: "double",
  real: "real",
  boolean: "boolean",
  bool: "boolean",
  timestamp: "timestamp",
  datetime: "timestamp",
  timestamptz: "timestamptz",
  date: "date",
  dateonly: "date",
  time: "time",
  json: "json",
  jsonb: "jsonb",
  uuid: "uuid",
  enum: "enum",
};

function splitArgs(argsText) {
  const args = [];
  let quote = null;
  let current = "";

  for (const c of argsText) {
    if (quote) {
      c == quote && (quote = null);
      current += c;
    } else if (c == "'" || c == '"') {
      quote = c;
      current += c;
    } else if (c == ",") {
      args.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  args.push(current);

  return args
    .map((arg) => arg.trim())
    .filter(Boolean)
    .map((arg) => {
      if (/^(['"]).*\1$/s.test(arg)) {
        return arg.substring(1, arg.length - 1);
      }
      return /^-?\d+(\.\d+)?$/.test(arg) ? Number(arg) : arg;
    });
}

const TEXT_SIZES = ["tiny", "medium", "long"];

const unquoteType = (rawType) => String(rawType || "").trim().replace(/^"(.*)"$/, "$1");

/**
 * Returns { name, args }, or null after reporting the problem to `collector`
 * with `location` ({ table, column, line }). A type that names an `Enum`
 * block in `enums` (Map name → Enum; exact name, no arguments) resolves to
 * { name: "enum", args: <values>, ref: <enum name> }.
 */
module.exports = function resolveType(rawType, location, collector, enums = new Map()) {
  const match = String(rawType || "")
    .trim()
    .match(/^([a-zA-Z_]\w*)\s*(?:\((.*)\))?$/s);
  const name = match && TYPES[match[1].toLowerCase()];
  const shared = !name && enums.get(unquoteType(rawType));

  if (shared) {
    return { name: "enum", args: shared.values.map((entry) => entry.value), ref: shared.name };
  }

  if (!name) {
    collector.add({ ...location, message: `Unsupported data type '${rawType}'` });
    return null;
  }

  const args = match[2] != undefined ? splitArgs(match[2]) : [];

  if (name == "enum" && args.length == 0) {
    collector.add({ ...location, message: "enum must have at least one value" });
    return null;
  }

  if (name == "text" && args.some((arg) => !TEXT_SIZES.includes(String(arg).toLowerCase()))) {
    collector.add({ ...location, message: "text accepts only tiny, medium or long" });
    return null;
  }

  return { name, args };
};

module.exports.TYPES = TYPES;
