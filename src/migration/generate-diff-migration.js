const parseSchema = require("../parse-schema");
const diffSchema = require("../diff/diff-schema");
const generateSnapshot = require("../snapshot/create-snapshot");
const { readSnapshot } = require("../snapshot/read-snapshot");
const { DataLossError } = require("../errors");
const { uniqueName, enumName } = require("../diff/derived-names");
const sortTables = require("./sort-tables");
const {
  str,
  typeSource,
  defaultSource,
  foreignKeyLines,
  laterConstraints,
  addConstraintSource,
  createTableSource,
  addIndexSource,
  postgresOnly,
  dropEnumSource,
} = require("./sources");

const TEXT = { name: "TEXT", args: [] };
const isEnum = (column) => column.type.name == "ENUM";

/**
 * The options object of a call, one entry per line.
 */
function objectSource(entries) {
  return `{\n${entries.map((entry) => `        ${entry},`).join("\n")}\n      }`;
}

/**
 * The definition `changeColumn` receives (research R3): type, allowNull,
 * defaultValue and comment only, never unique, references, primaryKey or
 * autoIncrement, which have their own operations.
 */
function sanitizedSource(column) {
  const entries = [
    `type: ${typeSource(column.type)}`,
    `allowNull: ${!(column.allowNull === false || column.primaryKey)}`,
  ];
  column.defaultValue && entries.push(`defaultValue: ${defaultSource(column.defaultValue)}`);
  column.comment && entries.push(`comment: ${str(column.comment)}`);
  return objectSource(entries);
}

/**
 * The definition `addColumn` receives: the column as `createTable` writes
 * it, without its foreign key (added by addConstraint) and without
 * primaryKey (added by the primary key constraint).
 */
function addColumnSource(table, column) {
  const entries = [`type: ${typeSource(column.type)}`];
  column.autoIncrement && entries.push("autoIncrement: true");
  column.allowNull != undefined && entries.push(`allowNull: ${column.allowNull}`);
  column.unique && entries.push("unique: true");
  column.defaultValue && entries.push(`defaultValue: ${defaultSource(column.defaultValue)}`);
  column.comment && entries.push(`comment: ${str(column.comment)}`);
  return `      await queryInterface.addColumn(${str(table)}, ${str(column.name)}, ${objectSource(entries)}, { transaction });`;
}

const call = (method, ...args) => `      await queryInterface.${method}(${[...args, "{ transaction }"].join(", ")});`;
const changeColumn = (table, column) =>
  `      await queryInterface.changeColumn(${str(table)}, ${str(column.name)}, ${sanitizedSource(column)}, { transaction });`;
const dropEnum = (name) => postgresOnly([dropEnumSource(name)]);
const removeConstraint = (table, name) => call("removeConstraint", str(table), str(name));

/**
 * Steps that take a column from definition `from` to definition `to`
 * (research R3, R5). `fromEnumName` is the enum type `from` uses.
 */
function columnSteps(table, from, to, { enumRebuild, fromEnumName }) {
  const withoutDefault = { ...to, defaultValue: undefined };
  const toEnum = () => [changeColumn(table, withoutDefault), ...(to.defaultValue ? [changeColumn(table, to)] : [])];

  if (enumRebuild) {
    return [changeColumn(table, { ...withoutDefault, type: TEXT }), dropEnum(fromEnumName), ...toEnum()];
  }

  if (!isEnum(from) && isEnum(to)) {
    return toEnum();
  }

  if (isEnum(from) && !isEnum(to)) {
    return [changeColumn(table, to), dropEnum(fromEnumName)];
  }

  return [changeColumn(table, to)];
}

function foreignKeyAdd(relationship, name) {
  const lines = [addConstraintSource(relationship.from.table, foreignKeyLines(relationship, name))];

  if (relationship.composite && relationship.kind == "one-to-one") {
    const unique = uniqueName(relationship.from.table, relationship.from.columns);
    lines.push(
      addConstraintSource(relationship.from.table, [`type: "unique"`, `fields: ${str(relationship.from.columns)}`, `name: ${str(unique)}`])
    );
  }

  return lines;
}

function foreignKeyRemove(relationship, name) {
  const lines = [];

  if (relationship.composite && relationship.kind == "one-to-one") {
    lines.push(removeConstraint(relationship.from.table, uniqueName(relationship.from.table, relationship.from.columns)));
  }

  return [...lines, removeConstraint(relationship.from.table, name)];
}

const enumDrops = (table) =>
  table.columns.filter(isEnum).map((column) => dropEnum(enumName(table.name, column.name)));

/**
 * Steps of the new tables: createTable in dependency order (cycles and
 * composite keys added afterwards), then their indexes, exactly as the
 * initial migration writes them.
 */
function newTableSteps(set) {
  const tables = set.changes.filter((change) => change.kind == "createTable").map((change) => change.definition);
  const names = new Set(tables.map((table) => table.name));
  const own = set.after.relationships.filter((relationship) => names.has(relationship.from.table));
  const { ordered, deferred } = sortTables({
    tables,
    relationships: own.filter((relationship) => names.has(relationship.to.table)),
  });

  const inlineRelationship = (table, column) =>
    own.find(
      (relationship) =>
        !relationship.composite &&
        relationship.from.table == table &&
        relationship.from.columns[0] == column &&
        !deferred.some((item) => item.table == table && item.column == column)
    );

  const steps = ordered.map((table) => ({
    phase: 5,
    up: [createTableSource(table, inlineRelationship)],
    down: [call("dropTable", str(table.name)), ...enumDrops(table)],
  }));

  for (const constraint of laterConstraints(own, deferred)) {
    steps.push({
      phase: 8.3,
      up: [addConstraintSource(constraint.table, constraint.lines)],
      down: [removeConstraint(constraint.table, constraint.name)],
    });
  }

  for (const table of ordered) {
    for (const index of table.indexes) {
      steps.push({
        phase: 8.4,
        up: [addIndexSource(table.name, index)],
        down: [call("removeIndex", str(table.name), str(index.name))],
      });
    }
  }

  return steps;
}

/**
 * Every change as up/down steps, in phase order (research R8). `down` runs
 * the same steps in reverse.
 */
function buildSteps(set) {
  const steps = [];
  const noInline = () => undefined;

  for (const change of set.changes) {
    const { table } = change;

    switch (change.kind) {
      case "removeForeignKey":
        steps.push({ phase: 1, up: foreignKeyRemove(change.relationship, change.name), down: foreignKeyAdd(change.relationship, change.name) });
        break;
      case "addForeignKey":
        steps.push({ phase: 8.3, up: foreignKeyAdd(change.relationship, change.name), down: foreignKeyRemove(change.relationship, change.name) });
        break;
      case "removeIndex":
        steps.push({ phase: 2.1, up: [call("removeIndex", str(table), str(change.index.name))], down: [addIndexSource(table, change.index)] });
        break;
      case "addIndex":
        steps.push({ phase: 8.4, up: [addIndexSource(table, change.index)], down: [call("removeIndex", str(table), str(change.index.name))] });
        break;
      case "removeUnique":
      case "addUnique": {
        const add = addConstraintSource(table, [`type: "unique"`, `fields: ${str(change.columns)}`, `name: ${str(change.name)}`]);
        const remove = removeConstraint(table, change.name);
        change.kind == "addUnique"
          ? steps.push({ phase: 8.2, up: [add], down: [remove] })
          : steps.push({ phase: 2.2, up: [remove], down: [add] });
        break;
      }
      case "changePrimaryKey": {
        const { beforeTable, beforeName, afterName } = change;
        const add = (on, fields, name) =>
          addConstraintSource(on, [`type: "primary key"`, `fields: ${str(fields)}`, `name: ${str(name)}`]);
        change.before.length &&
          steps.push({ phase: 2.3, up: [removeConstraint(beforeTable, beforeName)], down: [add(beforeTable, change.before, beforeName)] });
        change.after.length &&
          steps.push({ phase: 8.1, up: [add(table, change.after, afterName)], down: [removeConstraint(table, afterName)] });
        break;
      }
      case "renameTable":
        steps.push({ phase: 3.1, up: [call("renameTable", str(change.from), str(change.to))], down: [call("renameTable", str(change.to), str(change.from))] });
        break;
      case "renameColumn":
        steps.push({
          phase: 3.2,
          up: [call("renameColumn", str(table), str(change.from), str(change.to))],
          down: [call("renameColumn", str(table), str(change.to), str(change.from))],
        });
        break;
      case "removeColumn":
        steps.push({
          phase: 4.1,
          up: [call("removeColumn", str(table), str(change.column)), ...(isEnum(change.definition) ? [dropEnum(enumName(table, change.column))] : [])],
          down: [addColumnSource(table, change.definition)],
        });
        break;
      case "dropTable":
        steps.push({
          phase: 4.2,
          up: [call("dropTable", str(table)), ...enumDrops(change.definition)],
          down: [createTableSource(change.definition, noInline)],
        });
        break;
      case "addColumn":
        steps.push({
          phase: 6,
          up: [addColumnSource(table, change.definition)],
          down: [call("removeColumn", str(table), str(change.column)), ...(isEnum(change.definition) ? [dropEnum(enumName(table, change.column))] : [])],
        });
        break;
      case "changeColumn": {
        // a renamed enum column's type still has the snapshot's name until rebuilt
        const current = enumName(table, change.column);
        const previous = change.beforeEnumName || current;
        steps.push({
          phase: 7,
          up: columnSteps(table, change.before, change.after, { enumRebuild: change.enumRebuild, fromEnumName: previous }),
          down: columnSteps(table, change.after, change.before, { enumRebuild: change.enumRebuild, fromEnumName: current }),
        });
        break;
      }
    }
  }

  steps.push(...newTableSteps(set));

  return steps
    .map((step, position) => ({ step, position }))
    .sort((a, b) => a.step.phase - b.step.phase || a.position - b.position)
    .map(({ step }) => step);
}

function header(source, snapshotSource) {
  const from = [source, snapshotSource].filter(Boolean).join(" and ");
  return (
    `/**\n * Generated by dbml2sequelize diff${from ? ` from ${from}` : ""}.\n` +
    ` * Review it before applying it. Data is not moved or converted; add that by hand if needed.\n */\n`
  );
}

/**
 * Compares snapshot content with DBML text and returns the incremental
 * migration source and the new snapshot content, or nulls when there are no
 * changes (specs/003-incremental-migrations/contracts/public-api.md).
 */
module.exports = function generateDiffMigration(snapshotText, dbmlText, opts = {}) {
  const { source, snapshotSource, allowDataLoss = false } = opts;
  const snapshot = readSnapshot(snapshotText, snapshotSource || "snapshot");
  const set = diffSchema(snapshot, parseSchema(dbmlText));

  if (set.empty) {
    return { code: null, snapshot: null, changes: [] };
  }

  if (set.dataLoss.length && !allowDataLoss) {
    throw new DataLossError(
      set.dataLoss.map(({ table, column, dataLoss }) => ({ table, ...(column && { column }), message: dataLoss }))
    );
  }

  const steps = buildSteps(set);
  const up = steps.map((step) => step.up.join("\n"));
  const down = [...steps].reverse().map((step) => step.down.join("\n"));

  const code = `"use strict";

${header(source, snapshotSource)}/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
${up.join("\n\n")}
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
${down.join("\n")}
    });
  },
};
`;

  return {
    code,
    snapshot: generateSnapshot(dbmlText, { source: source || "" }),
    changes: set.changes,
  };
};
