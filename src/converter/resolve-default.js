/**
 * Normalizes a DBML default into one of:
 *   { kind: "fn", value: "now" }                    the current time
 *   { kind: "literal", value: "CURRENT_TIMESTAMP" } a raw SQL expression
 *   { kind: "value", value: "active" | 1 | true | null }
 * Each target dialect decides how to write these.
 */
const { cleanNote } = require("./convert-note");

module.exports = function resolveDefault(rawDefault, type) {
  let value = String(rawDefault).trim();
  const isExpression = /^`.*`$/s.test(value);

  if (isExpression) {
    value = value.substring(1, value.length - 1).trim();
  }

  if (/^now\(\)$/i.test(value)) {
    return { kind: "fn", value: "now" };
  }

  if (isExpression || /^(CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME)$/i.test(value)) {
    return { kind: "literal", value };
  }

  if (/^(['"]).*\1$/s.test(value)) {
    return { kind: "value", value: cleanNote(value) };
  }

  if (/^null$/i.test(value)) {
    return { kind: "value", value: null };
  }

  if (type.name == "boolean") {
    if (/^(true|1)$/i.test(value)) return { kind: "value", value: true };
    if (/^(false|0)$/i.test(value)) return { kind: "value", value: false };
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return { kind: "value", value: Number(value) };
  }

  return { kind: "value", value };
};
