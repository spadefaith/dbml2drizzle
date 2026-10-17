const parseSchema = require("../parse-schema");

const FORMAT = 1;

const without = (object, keys) =>
  Object.fromEntries(Object.entries(object).filter(([name]) => !keys.includes(name)));

/**
 * The schema part of a snapshot: the schema description without source
 * locations, patch edits or directives (research R1).
 */
function snapshotSchema(schema) {
  return {
    tables: schema.tables.map((table) => ({
      ...without(table, ["line", "renamedFrom"]),
      columns: table.columns.map((column) => without(column, ["line", "renamedFrom"])),
    })),
    relationships: schema.relationships.map((relationship) => without(relationship, ["declaredAt"])),
  };
}

/**
 * Snapshot file content for DBML text (contracts/snapshot-file.md).
 */
function generateSnapshot(dbmlText, { source = "" } = {}) {
  const snapshot = { format: FORMAT, source, schema: snapshotSchema(parseSchema(dbmlText)) };
  return JSON.stringify(snapshot, null, 2) + "\n";
}

module.exports = generateSnapshot;
module.exports.FORMAT = FORMAT;
module.exports.snapshotSchema = snapshotSchema;
