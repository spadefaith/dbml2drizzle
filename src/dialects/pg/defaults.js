/**
 * Default modifier for a column default (see converter/resolve-default.js):
 * { text, usesSql }.
 */
module.exports = function defaultModifier(defaultValue) {
  const { kind, value } = defaultValue;

  if (kind == "fn" && value == "now") {
    return { text: ".defaultNow()", usesSql: false };
  }

  if (kind == "literal") {
    const escaped = String(value).replace(/[\\`]/g, "\\$&").replace(/\$\{/g, "\\${");
    return { text: `.default(sql\`${escaped}\`)`, usesSql: true };
  }

  return { text: `.default(${JSON.stringify(value)})`, usesSql: false };
};
