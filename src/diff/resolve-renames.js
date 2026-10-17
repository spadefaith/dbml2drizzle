const { indexName } = require("./derived-names");

/**
 * Each copied table, column, index and relationship points to the snapshot
 * object it came from, so steps that run before the renames can use the old
 * names. Symbol keys stay out of JSON comparisons.
 */
const ORIGINAL = Symbol("original");
const original = (object) => (object && object[ORIGINAL]) || object;

function copySchema(schema) {
  return {
    tables: schema.tables.map((table) => ({
      ...table,
      [ORIGINAL]: table,
      columns: table.columns.map((column) => ({ ...column, [ORIGINAL]: column })),
      indexes: table.indexes.map((index) => ({ ...index, fields: [...index.fields], [ORIGINAL]: index })),
    })),
    relationships: schema.relationships.map((relationship) => ({
      ...relationship,
      from: { ...relationship.from, columns: [...relationship.from.columns] },
      to: { ...relationship.to, columns: [...relationship.to.columns] },
      [ORIGINAL]: relationship,
    })),
  };
}

/**
 * Renames a table in the copied schema: its name, every relationship side
 * and every index name derived from it.
 */
function renameTable(schema, from, to) {
  const table = schema.tables.find((item) => item.name == from);
  table.name = to;

  for (const index of table.indexes) {
    index.name == indexName(from, index.fields) && (index.name = indexName(to, index.fields));
  }

  for (const relationship of schema.relationships) {
    relationship.from.table == from && (relationship.from.table = to);
    relationship.to.table == from && (relationship.to.table = to);
  }
}

function renameColumn(schema, tableName, from, to) {
  const table = schema.tables.find((item) => item.name == tableName);
  table.columns.find((column) => column.name == from).name = to;

  for (const index of table.indexes) {
    const derived = index.name == indexName(tableName, index.fields);
    index.fields = index.fields.map((field) => (field == from ? to : field));
    derived && (index.name = indexName(tableName, index.fields));
  }

  for (const relationship of schema.relationships) {
    for (const side of [relationship.from, relationship.to]) {
      side.table == tableName && (side.columns = side.columns.map((column) => (column == from ? to : column)));
    }
  }
}

/**
 * Matches `renamed_from` against the snapshot (spec FR-017–FR-019,
 * research R10). Returns the rename changes and a copy of the snapshot
 * schema with them applied. Problems are added to `collector`.
 */
function resolveRenames(snapshot, after, collector) {
  const before = copySchema(snapshot);
  const renames = [];
  const claims = new Map();

  for (const table of after.tables) {
    const old = table.renamedFrom;

    if (!old) {
      continue;
    }

    const location = { table: table.name, line: table.line };

    if (claims.has(old)) {
      collector.add({ ...location, message: `renamed_from '${old}' is also claimed by table '${claims.get(old)}'` });
      continue;
    }

    claims.set(old, table.name);

    if (after.tables.some((item) => item.name == old)) {
      collector.add({ ...location, message: `renamed_from '${old}' names table '${old}', which is still declared` });
    } else if (before.tables.some((item) => item.name == table.name)) {
      // already applied by an earlier migration (FR-018)
    } else if (!before.tables.some((item) => item.name == old)) {
      collector.add({ ...location, message: `renamed_from '${old}' matches no table in the snapshot` });
    } else {
      renameTable(before, old, table.name);
      renames.push({ kind: "renameTable", table: table.name, from: old, to: table.name });
    }
  }

  for (const table of after.tables) {
    const previous = before.tables.find((item) => item.name == table.name);
    const columnClaims = new Map();

    for (const column of table.columns) {
      const old = column.renamedFrom;

      if (!old) {
        continue;
      }

      const location = { table: table.name, column: column.name, line: column.line };

      if (columnClaims.has(old)) {
        collector.add({ ...location, message: `renamed_from '${old}' is also claimed by column '${columnClaims.get(old)}'` });
        continue;
      }

      columnClaims.set(old, column.name);

      const has = (name) => previous && previous.columns.some((item) => item.name == name);

      if (table.columns.some((item) => item.name == old)) {
        collector.add({ ...location, message: `renamed_from '${old}' names column '${old}', which is still declared` });
      } else if (has(column.name)) {
        // already applied by an earlier migration (FR-018)
      } else if (!has(old)) {
        collector.add({ ...location, message: `renamed_from '${old}' matches no column of '${table.name}' in the snapshot` });
      } else {
        renameColumn(before, table.name, old, column.name);
        renames.push({ kind: "renameColumn", table: table.name, column: column.name, from: old, to: column.name });
      }
    }
  }

  return { renames, before };
}

module.exports = resolveRenames;
module.exports.original = original;
