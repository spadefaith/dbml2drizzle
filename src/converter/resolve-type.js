/**
 * Maps a DBML column type, e.g. varchar(100), decimal(18,2) or
 * enum('a','b'), to a Sequelize DataTypes name plus its arguments.
 */
const TYPES = {
  varchar: "STRING",
  string: "STRING",
  char: "CHAR",
  text: "TEXT",
  integer: "INTEGER",
  int: "INTEGER",
  bigint: "BIGINT",
  smallint: "SMALLINT",
  decimal: "DECIMAL",
  numeric: "DECIMAL",
  float: "FLOAT",
  double: "DOUBLE",
  real: "REAL",
  boolean: "BOOLEAN",
  bool: "BOOLEAN",
  timestamp: "DATE",
  timestamptz: "DATE",
  datetime: "DATE",
  date: "DATE",
  dateonly: "DATEONLY",
  time: "TIME",
  json: "JSON",
  jsonb: "JSONB",
  uuid: "UUID",
  enum: "ENUM",
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

/**
 * Returns { name, args }, or null after reporting the problem to `collector`
 * with `location` ({ table, column, line }).
 */
module.exports = function resolveType(rawType, location, collector) {
  const match = String(rawType || "")
    .trim()
    .match(/^([a-zA-Z_]\w*)\s*(?:\((.*)\))?$/s);
  const name = match && TYPES[match[1].toLowerCase()];

  if (!name) {
    collector.add({ ...location, message: `Unsupported data type '${rawType}'` });
    return null;
  }

  const args = match[2] != undefined ? splitArgs(match[2]) : [];

  if (name == "ENUM" && args.length == 0) {
    collector.add({ ...location, message: "enum must have at least one value" });
    return null;
  }

  if (name == "TEXT" && args.some((arg) => !TEXT_SIZES.includes(String(arg).toLowerCase()))) {
    collector.add({ ...location, message: "text accepts only tiny, medium or long" });
    return null;
  }

  return { name, args };
};
