// @ts-check
const parseSchema = require("../parse-schema");
const { createCollector } = require("../errors");
const { getDialect } = require("../dialects");
const { propertyKey, member, tableExports } = require("./identifiers");
const buildRelations = require("./relations");
const { findEnum } = require("./collect-enums");
const leadsBack = require("./cycles");

/**
 * A note as a JSDoc comment, with `*\/` escaped so it cannot end the comment.
 *
 * @param {string | undefined} text
 * @param {string} indent
 * @returns {string[]}
 */
function jsDoc(text, indent) {
  if (!text) {
    return [];
  }

  const lines = String(text).replace(/\*\//g, "*\\/").split(/\r?\n/);

  return lines.length == 1
    ? [`${indent}/** ${lines[0]} */`]
    : [`${indent}/**`, ...lines.map((line) => `${indent} * ${line}`.trimEnd()), `${indent} */`];
}

/** @param {string} value */
const action = (value) => JSON.stringify(String(value).toLowerCase());

/** @param {{ onDelete?: string, onUpdate?: string }} relationship */
const actionOptions = ({ onDelete, onUpdate }) =>
  [onDelete && `onDelete: ${action(onDelete)}`, onUpdate && `onUpdate: ${action(onUpdate)}`].filter(Boolean);

/**
 * `text` escaped for a template literal, so the SQL keeps it exactly.
 *
 * @param {string} text
 */
const templateText = (text) => text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

/** @param {Set<string>} set */
const sorted = (set) => [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * Generates the Drizzle schema source for one target dialect from DBML text.
 * Sections come in a fixed order (header, imports, enums, tables, relations;
 * see specs/004-drizzle-schema-generation/data-model.md), so the same DBML
 * always gives the same output. Throws DbmlError listing every problem.
 *
 * @typedef {{ dialect?: import("../dialects").DialectId, sourceName?: string }} GenerateSchemaOptions
 *
 * @param {string} dbmlText
 * @param {GenerateSchemaOptions} [opts]
 * @returns {string}
 */
module.exports = function generateSchema(dbmlText, opts = {}) {
  const { dialect: dialectId = "pg", sourceName = "schema.dbml" } = opts;
  const dialect = getDialect(dialectId);
  const schema = parseSchema(dbmlText);
  const collector = createCollector();
  const ormImports = new Set();
  const builders = new Set([dialect.tableBuilder]);

  const enums = dialect.collectEnums(schema, collector);
  const enumExports = new Map();

  for (const e of enums) {
    const other = enumExports.get(e.exportName);
    other != undefined && other != e.dbName &&
      collector.add({
        line: e.line,
        message: `Enum name '${other}' and '${e.dbName}' both become '${e.exportName}' in generated code`,
      });
    other == undefined && enumExports.set(e.exportName, e.dbName);
  }

  const exports = tableExports(schema.tables, collector, enumExports);
  enums.length && dialect.enumBuilder && builders.add(dialect.enumBuilder);

  // references in a cycle get a typed callback: TypeScript cannot infer those tables
  const isCyclic = leadsBack(schema.relationships);
  let typedReferences = false;

  const tableBlocks = schema.tables.map((table) => {
    const own = exports.get(table.name);
    const outgoing = schema.relationships.filter((relationship) => relationship.from.table == table.name);
    const pkColumns = table.columns.filter((column) => column.primaryKey);
    const lines = [
      ...jsDoc(table.comment, ""),
      `export const ${own} = ${dialect.tableBuilder}(${JSON.stringify(table.name)}, {`,
    ];

    for (const column of table.columns) {
      const location = { table: table.name, column: column.name, line: column.line };
      const enumDef = findEnum(enums, table, column);
      const result = !enumDef
        ? dialect.columnCall(column, location, collector, table)
        : dialect.enumColumnCall
          ? dialect.enumColumnCall(enumDef, column, location, collector, table)
          : { builders: [], text: `${enumDef.exportName}(${JSON.stringify(column.name)})` };

      if (!result) {
        continue;
      }

      result.builders.forEach((builder) => builders.add(builder));
      let call = result.text;

      if (pkColumns.length == 1 && column.primaryKey) {
        call += dialect.primaryKeyModifier ? dialect.primaryKeyModifier(column) : ".primaryKey()";
      }

      if (column.allowNull === false) call += ".notNull()";
      if (column.unique) call += ".unique()";

      if (column.defaultValue) {
        const modifier = dialect.defaultModifier(column.defaultValue);
        modifier.usesSql && ormImports.add("sql");
        call += modifier.text;
      }

      for (const relationship of outgoing) {
        if (relationship.composite || relationship.from.columns[0] != column.name) {
          continue;
        }

        const target = exports.get(relationship.to.table);
        const options = actionOptions(relationship);
        const typed = Boolean(dialect.anyColumnType) && isCyclic(relationship.from.table, relationship.to.table);
        typed && (typedReferences = true);
        call += `.references(${typed ? `(): ${dialect.anyColumnType} =>` : "() =>"} ${member(target, relationship.to.columns[0])}`;
        call += options.length ? `, { ${options.join(", ")} })` : ")";
      }

      lines.push(...jsDoc(column.comment, "  "), `  ${propertyKey(column.name)}: ${call},`);
    }

    const extra = [];

    if (pkColumns.length > 1) {
      builders.add("primaryKey");
      extra.push(`primaryKey({ columns: [${pkColumns.map((column) => member("t", column.name)).join(", ")}] })`);
    }

    for (const relationship of outgoing.filter((item) => item.composite)) {
      const target = relationship.to.table == table.name ? "t" : exports.get(relationship.to.table);
      const columns = relationship.from.columns.map((column) => member("t", column)).join(", ");
      const foreignColumns = relationship.to.columns.map((column) => member(target, column)).join(", ");
      let text = `foreignKey({ columns: [${columns}], foreignColumns: [${foreignColumns}] })`;

      if (relationship.onDelete) text += `.onDelete(${action(relationship.onDelete)})`;
      if (relationship.onUpdate) text += `.onUpdate(${action(relationship.onUpdate)})`;

      builders.add("foreignKey");
      extra.push(text);
    }

    for (const index of table.indexes) {
      // index entries carry no line, so the table's line locates the error
      if (index.using && dialect.indexTypes === false) {
        collector.add({
          table: table.name,
          line: table.line,
          message: `Index type '${index.using}' is not supported on ${dialect.label || dialect.id}`,
        });
        continue;
      }

      const builder = index.unique ? "uniqueIndex" : "index";
      const columns = index.parts
        .map((part) => ("column" in part ? member("t", part.column) : `sql\`${templateText(part.expression)}\``))
        .join(", ");
      const target = index.using ? `.using(${JSON.stringify(index.using.toLowerCase())}, ${columns})` : `.on(${columns})`;
      const where = index.where ? `.where(sql\`${templateText(index.where)}\`)` : "";

      (where || index.parts.some((part) => "expression" in part)) && ormImports.add("sql");
      builders.add(builder);
      extra.push(`${builder}(${JSON.stringify(index.name)})${target}${where}`);
    }

    for (const check of table.checks) {
      builders.add(dialect.checkBuilder);
      ormImports.add("sql");
      extra.push(`${dialect.checkBuilder}(${JSON.stringify(check.name)}, sql\`${templateText(check.expression)}\`)`);
    }

    // checks the dialect generates (e.g. D1 enum checks), after the declared ones
    for (const check of dialect.tableChecks ? dialect.tableChecks(table, enums) : []) {
      if (table.checks.some((declared) => declared.name == check.name)) {
        const column = table.columns.find((item) => item.name == check.column);
        collector.add({
          table: table.name,
          column: check.column,
          line: column && column.line,
          message: `Check name '${check.name}' is declared and also generated for enum column ${table.name}.${check.column}`,
        });
        continue;
      }

      builders.add(dialect.checkBuilder);
      ormImports.add("sql");
      extra.push(`${dialect.checkBuilder}(${JSON.stringify(check.name)}, sql\`${templateText(check.expression)}\`)`);
    }

    lines.push(extra.length ? `}, (t) => [\n${extra.map((item) => `  ${item},`).join("\n")}\n]);` : "});");
    return lines.join("\n");
  });

  const relations = buildRelations(schema, exports, collector);
  relations.length && ormImports.add("relations");

  collector.throwIfAny();

  const imports = [
    ormImports.size && `import { ${sorted(ormImports).join(", ")} } from "drizzle-orm";`,
    `import { ${sorted(builders).join(", ")} } from ${JSON.stringify(dialect.module)};`,
    typedReferences && `import type { ${dialect.anyColumnType} } from ${JSON.stringify(dialect.module)};`,
  ].filter(Boolean);

  const sections = [
    `// Generated by dbml2drizzle from ${sourceName}. Do not edit by hand.\n${imports.join("\n")}`,
    enums.length && enums.map(dialect.enumDeclaration).join("\n"),
    ...tableBlocks,
    ...relations,
  ].filter(Boolean);

  return `${sections.join("\n\n")}\n`;
};
