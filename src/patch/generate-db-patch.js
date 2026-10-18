const parseSchema = require("../parse-schema");

const MOVED_REFS_COMMENT = "// Relationships moved from inline settings by dbml2drizzle";

/**
 * Generates `db-patch.dbml`: a copy of the DBML that standard DBML tooling
 * (e.g. dbdocs) accepts. Only the lines the parser recorded in
 * `patchEdits` are replaced; every other line is copied as is. Standalone
 * `Ref:` lines for moved relationships are appended at the end.
 *
 * This module never reads DBML syntax itself (Principle III).
 */
module.exports = function generateDbPatch(dbmlText) {
  const text = String(dbmlText);
  const { patchEdits } = parseSchema(text);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);

  for (const edit of patchEdits) {
    edit.replacement != undefined && (lines[edit.line - 1] = edit.replacement);
  }

  // removals win over replacements of the same line (e.g. `Note: {` inside an Enum)
  for (const edit of patchEdits) {
    edit.remove && (lines[edit.line - 1] = null);
  }

  const kept = lines.filter((line) => line !== null);
  lines.length = 0;
  lines.push(...kept);

  const refs = patchEdits.filter((edit) => edit.appendRef).map((edit) => edit.appendRef);

  if (!refs.length) {
    return lines.join(eol);
  }

  const body = lines.join(eol).replace(/(\r?\n)+$/, "");
  return [body, "", MOVED_REFS_COMMENT, ...refs, ""].join(eol);
};
