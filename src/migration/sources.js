/**
 * Source builders shared by the initial and the incremental migration
 * generators, so both write tables, columns, indexes and constraints the
 * same way (Principle III).
 */

const { foreignKeyName, uniqueName } = require("../diff/derived-names");

const str = (value) => JSON.stringify(value);
const key = (name) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : str(name));

function typeSource({ name, args }) {
  return args.length ? `Sequelize.${name}(${args.map(str).join(", ")})` : `Sequelize.${name}`;
}

function defaultSource({ kind, value }) {
  if (kind == "fn") return `Sequelize.fn(${str(value)})`;
  if (kind == "literal") return `Sequelize.literal(${str(value)})`;
  return str(value);
}

/**
 * Source of one column attribute, keys in contract order:
 * type, primaryKey, autoIncrement, allowNull, unique, defaultValue,
 * references, onDelete, onUpdate, comment.
 */
function columnSource(column, relationship, indent) {
  const pad = " ".repeat(indent + 2);
  const lines = [`${pad}type: ${typeSource(column.type)},`];

  column.primaryKey && lines.push(`${pad}primaryKey: true,`);
  column.autoIncrement && lines.push(`${pad}autoIncrement: true,`);
  column.allowNull != undefined && lines.push(`${pad}allowNull: ${column.allowNull},`);
  column.unique && lines.push(`${pad}unique: true,`);
  column.defaultValue && lines.push(`${pad}defaultValue: ${defaultSource(column.defaultValue)},`);

  if (relationship) {
    const { to } = relationship;
    lines.push(`${pad}references: { model: ${str(to.table)}, key: ${str(to.columns[0])} },`);
    relationship.onDelete && lines.push(`${pad}onDelete: ${str(relationship.onDelete)},`);
    relationship.onUpdate && lines.push(`${pad}onUpdate: ${str(relationship.onUpdate)},`);
  }

  column.comment && lines.push(`${pad}comment: ${str(column.comment)},`);

  const head = " ".repeat(indent);
  return `${head}${key(column.name)}: {\n${lines.join("\n")}\n${head}},`;
}

function optionsSource(options) {
  return `{ ${options.join(", ")} }`;
}

/**
 * Option lines of the `addConstraint` call for a foreign key.
 */
function foreignKeyLines(relationship, name) {
  const { from, to } = relationship;
  const lines = [
    `type: "foreign key"`,
    `fields: ${str(from.columns)}`,
    `name: ${str(name)}`,
    relationship.composite
      ? `references: { table: ${str(to.table)}, fields: ${str(to.columns)} }`
      : `references: { table: ${str(to.table)}, field: ${str(to.columns[0])} }`,
  ];
  relationship.onDelete && lines.push(`onDelete: ${str(relationship.onDelete)}`);
  relationship.onUpdate && lines.push(`onUpdate: ${str(relationship.onUpdate)}`);
  return lines;
}

/**
 * Constraints added with addConstraint after all tables exist: foreign keys
 * deferred by reference cycles, composite foreign keys, and the unique
 * constraint of composite one-to-one references.
 * Returns [{ table, name, lines }] where `lines` are the option lines.
 */
function laterConstraints(relationships, deferred) {
  const constraints = [];

  for (const relationship of relationships) {
    const { from } = relationship;
    const isDeferred =
      !relationship.composite &&
      deferred.some((item) => item.table == from.table && item.column == from.columns[0]);

    if (!relationship.composite && !isDeferred) {
      continue;
    }

    const name = foreignKeyName(from.table, from.columns);
    constraints.push({ table: from.table, name, lines: foreignKeyLines(relationship, name) });

    if (relationship.composite && relationship.kind == "one-to-one") {
      const unique = uniqueName(from.table, from.columns);
      constraints.push({
        table: from.table,
        name: unique,
        lines: [`type: "unique"`, `fields: ${str(from.columns)}`, `name: ${str(unique)}`],
      });
    }
  }

  return constraints;
}

/**
 * Source of `addConstraint(table, { …lines, transaction })`.
 */
function addConstraintSource(table, lines) {
  const body = [...lines, "transaction"].map((line) => `        ${line},`).join("\n");
  return `      await queryInterface.addConstraint(${str(table)}, {\n${body}\n      });`;
}

/**
 * Source of the `createTable` call for one table. `inlineRelationship(table,
 * column)` returns the single-column relationship to write inline, if any.
 */
function createTableSource(table, inlineRelationship) {
  const columns = table.columns
    .map((column) => columnSource(column, inlineRelationship(table.name, column.name), 10))
    .join("\n");
  const options = table.comment
    ? optionsSource([`comment: ${str(table.comment)}`, "transaction"])
    : optionsSource(["transaction"]);

  return (
    `      await queryInterface.createTable(\n` +
    `        ${str(table.name)},\n` +
    `        {\n${columns}\n        },\n` +
    `        ${options}\n` +
    `      );`
  );
}

/**
 * Source of the `addIndex` call for one index of a table.
 */
function addIndexSource(tableName, index) {
  const options = [`name: ${str(index.name)}`];
  index.unique && options.push("unique: true");
  index.using && options.push(`using: ${str(index.using)}`);
  options.push("transaction");

  return `      await queryInterface.addIndex(${str(tableName)}, ${str(index.fields)}, ${optionsSource(options)});`;
}

/**
 * The PostgreSQL guard around enum-type operations, which Sequelize only
 * offers for PostgreSQL.
 */
function postgresOnly(lines) {
  return (
    `      if (queryInterface.sequelize.getDialect() === "postgres") {\n` +
    lines.map((line) => `  ${line}`).join("\n") +
    `\n      }`
  );
}

function dropEnumSource(name) {
  return `      await queryInterface.dropEnum(${str(name)}, { transaction });`;
}

module.exports = {
  str,
  key,
  typeSource,
  defaultSource,
  columnSource,
  optionsSource,
  foreignKeyLines,
  laterConstraints,
  addConstraintSource,
  createTableSource,
  addIndexSource,
  postgresOnly,
  dropEnumSource,
};
