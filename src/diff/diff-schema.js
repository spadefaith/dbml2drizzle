const { createCollector } = require("../errors");
const resolveRenames = require("./resolve-renames");
const findUnsupportedChanges = require("./unsupported-changes");
const classifyDataLoss = require("./classify-data-loss");
const { FOOTER } = findUnsupportedChanges;
const { original } = resolveRenames;
const { foreignKeyName, uniqueName, primaryKeyName, enumName } = require("./derived-names");

/**
 * Order of change kinds in the change set: the phases of
 * specs/003-incremental-migrations/research.md R8.
 */
const PHASES = {
  removeForeignKey: 1,
  removeIndex: 2.1,
  removeUnique: 2.2,
  changePrimaryKey: 2.3,
  renameTable: 3.1,
  renameColumn: 3.2,
  removeColumn: 4.1,
  dropTable: 4.2,
  createTable: 5,
  addColumn: 6,
  changeColumn: 7,
  addUnique: 8.2,
  addForeignKey: 8.3,
  addIndex: 8.4,
};

const same = (a, b) => JSON.stringify(a) == JSON.stringify(b);
const nullable = (column) => !(column.allowNull === false || column.primaryKey);
const relationshipKey = ({ from }) => `${from.table}.${from.columns.join(",")}`;
const primaryKeyOf = (table) => table.columns.filter((column) => column.primaryKey).map((column) => column.name);
const sameSet = (a, b) => same([...a].sort(), [...b].sort());

function sameRelationship(a, b) {
  return (
    same(a.to, b.to) &&
    a.onDelete == b.onDelete &&
    a.onUpdate == b.onUpdate &&
    // single-column one-to-one only adds a unique rule, compared on the column
    (!a.composite || a.kind == b.kind)
  );
}

function sameIndex(a, b) {
  return same(a.fields, b.fields) && Boolean(a.unique) == Boolean(b.unique) && a.using == b.using;
}

/**
 * Fields of a column that changed and that a sanitized changeColumn applies
 * (research R3). Auto-increment differences are unsupported and reported
 * separately.
 */
function changedFields(previous, column) {
  const fields = [];
  !same(previous.type, column.type) && fields.push("type");
  nullable(previous) != nullable(column) && fields.push("allowNull");
  !same(previous.defaultValue, column.defaultValue) && fields.push("defaultValue");
  (previous.comment || "") != (column.comment || "") && fields.push("comment");
  return fields;
}

/**
 * Compares the snapshot schema with the current schema and returns the
 * change set (specs/003-incremental-migrations/data-model.md). Throws one
 * DbmlError listing every rename problem and unsupported change.
 */
module.exports = function diffSchema(snapshot, after) {
  const collector = createCollector();
  const { renames, before } = resolveRenames(snapshot, after, collector);
  const unsupported = findUnsupportedChanges(before, after, collector);

  collector.throwIfAny(unsupported ? FOOTER : undefined);

  const changes = [...renames];
  const add = (change) => changes.push({ ...change, dataLoss: false });

  const beforeTable = (name) => before.tables.find((table) => table.name == name);
  const afterTable = (name) => after.tables.find((table) => table.name == name);
  const isNewTable = (name) => !beforeTable(name);

  const typeChanged = new Set();
  const primaryKeyChanged = new Set();
  const uniqueRemoved = new Set();

  // Tables
  for (const table of after.tables) {
    if (isNewTable(table.name)) {
      add({ kind: "createTable", table: table.name, definition: table });
    }
  }

  for (const table of [...before.tables].reverse()) {
    if (!afterTable(table.name)) {
      add({ kind: "dropTable", table: table.name, definition: table });

      for (const index of table.indexes) {
        add({ kind: "removeIndex", table: table.name, index });
      }
    }
  }

  // Columns, primary keys, unique rules and indexes of tables on both sides.
  // Removals run before the renames, so they use the snapshot's names
  // (`original`); additions run after them and use the current names.
  for (const table of after.tables) {
    const old = beforeTable(table.name);

    if (!old) {
      continue;
    }

    const oldName = original(old).name;
    const oldColumnName = (column) => original(column).name;

    for (const column of table.columns) {
      const previous = old.columns.find((item) => item.name == column.name);

      if (!previous) {
        add({ kind: "addColumn", table: table.name, column: column.name, definition: column });
        continue;
      }

      const fields = changedFields(previous, column);
      const beforeEnumName = enumName(oldName, oldColumnName(previous));
      const enumRenamed = column.type.name == "ENUM" && previous.type.name == "ENUM" && beforeEnumName != enumName(table.name, column.name);
      const enumRebuild =
        previous.type.name == "ENUM" && column.type.name == "ENUM" && (!same(previous.type, column.type) || enumRenamed);

      if (fields.length || enumRebuild) {
        add({ kind: "changeColumn", table: table.name, column: column.name, before: previous, after: column, fields, enumRebuild, beforeEnumName });
        (fields.includes("type") || enumRebuild) && typeChanged.add(`${table.name}.${column.name}`);
      }

      const oldUnique = uniqueName(oldName, [oldColumnName(previous)]);
      const newUnique = uniqueName(table.name, [column.name]);
      const uniqueRenamed = previous.unique && column.unique && oldUnique != newUnique;

      if (previous.unique && (!column.unique || uniqueRenamed)) {
        add({ kind: "removeUnique", table: oldName, column: oldColumnName(previous), columns: [oldColumnName(previous)], name: oldUnique });
        uniqueRemoved.add(`${table.name}.${column.name}`);
      }

      if (column.unique && (!previous.unique || uniqueRenamed)) {
        add({ kind: "addUnique", table: table.name, column: column.name, columns: [column.name], name: newUnique });
      }
    }

    for (const previous of old.columns) {
      if (!table.columns.some((column) => column.name == previous.name)) {
        add({ kind: "removeColumn", table: table.name, column: previous.name, definition: previous });
      }
    }

    const oldKey = primaryKeyOf(old);
    const newKey = primaryKeyOf(table);
    const keyChanged = !sameSet(oldKey, newKey);
    const keyRenamed = oldKey.length > 0 && !keyChanged && primaryKeyName(oldName) != primaryKeyName(table.name);

    if (keyChanged || keyRenamed) {
      add({
        kind: "changePrimaryKey",
        table: table.name,
        beforeTable: oldName,
        before: old.columns.filter((column) => column.primaryKey).map(oldColumnName),
        after: newKey,
        beforeName: primaryKeyName(oldName),
        afterName: primaryKeyName(table.name),
        keyChanged,
      });
      oldKey.length && primaryKeyChanged.add(table.name);
    }

    const indexRenamed = (index) => original(index).name != index.name;

    for (const index of old.indexes) {
      const current = table.indexes.find((item) => item.name == index.name);

      if (!current || !sameIndex(index, current) || indexRenamed(index)) {
        add({ kind: "removeIndex", table: oldName, index: original(index) });
      }
    }

    for (const index of table.indexes) {
      const previous = old.indexes.find((item) => item.name == index.name);

      if (!previous || !sameIndex(previous, index) || indexRenamed(previous)) {
        add({ kind: "addIndex", table: table.name, index });
      }
    }
  }

  // Foreign keys, matched by the columns that hold them. A new table's own
  // keys are part of creating it. A key is replaced when it changed, when a
  // column or key it depends on changes, or when its derived name changes
  // with a rename.
  const dependsOnChange = (relationship) =>
    relationship.from.columns.some((column) => typeChanged.has(`${relationship.from.table}.${column}`)) ||
    relationship.to.columns.some((column) => typeChanged.has(`${relationship.to.table}.${column}`)) ||
    primaryKeyChanged.has(relationship.to.table) ||
    (relationship.to.columns.length == 1 && uniqueRemoved.has(`${relationship.to.table}.${relationship.to.columns[0]}`));

  const nameOf = (relationship) => foreignKeyName(relationship.from.table, relationship.from.columns);
  const renamedKey = (relationship) => nameOf(original(relationship)) != nameOf(relationship);
  const fkChange = (kind, relationship) => ({
    kind,
    table: relationship.from.table,
    relationship,
    name: nameOf(relationship),
  });

  for (const relationship of before.relationships) {
    const current = after.relationships.find((item) => relationshipKey(item) == relationshipKey(relationship));

    if (!current || !sameRelationship(relationship, current) || dependsOnChange(current) || renamedKey(relationship)) {
      add(fkChange("removeForeignKey", original(relationship)));
    }
  }

  for (const relationship of after.relationships) {
    if (isNewTable(relationship.from.table)) {
      continue;
    }

    const previous = before.relationships.find((item) => relationshipKey(item) == relationshipKey(relationship));

    if (!previous || !sameRelationship(previous, relationship) || dependsOnChange(relationship) || renamedKey(previous)) {
      add(fkChange("addForeignKey", relationship));
    }
  }

  // Stable sort by phase: file order is kept inside each phase
  const ordered = changes
    .map((change, position) => ({ change, position }))
    .sort((a, b) => PHASES[a.change.kind] - PHASES[b.change.kind] || a.position - b.position)
    .map(({ change }) => change);

  return classifyDataLoss({
    renames,
    changes: ordered,
    dataLoss: [],
    empty: ordered.length == 0,
    before,
    after,
  });
};

module.exports.PHASES = PHASES;
