const { propertyKey, member } = require("./identifiers");

const pairKey = (a, b) => [a, b].sort().join("\u0000");

/**
 * Drizzle relations() declarations for every relationship, on both sides,
 * in table file order. Naming rules (README, research R3):
 *
 * - foreign-key side: the column without a trailing `_id`/`Id`; otherwise
 *   (no such suffix, or the name is taken) `<column>_<target table>`; the
 *   target table name for composite keys;
 * - referenced side: the source table name;
 * - a self-reference, or a table pair with more than one relationship, gets
 *   relationName `<from table>_<from columns>`, and its referenced side is
 *   named `<from table>_by_<from columns>`.
 *
 * A name that is still taken (by a column or another relation) is reported.
 * Relationships are handled in table and column file order, so inline and
 * standalone references give the same output.
 */
module.exports = function buildRelations(schema, exports, collector) {
  const { tables } = schema;
  const tableIndex = (name) => tables.findIndex((table) => table.name == name);
  const columnIndex = ({ table, columns }) =>
    tables[tableIndex(table)].columns.findIndex((column) => column.name == columns[0]);
  const relationships = [...schema.relationships].sort(
    (a, b) =>
      tableIndex(a.from.table) - tableIndex(b.from.table) ||
      columnIndex(a.from) - columnIndex(b.from) ||
      tableIndex(a.to.table) - tableIndex(b.to.table) ||
      a.from.columns.length - b.from.columns.length
  );
  const pairCount = new Map();

  for (const { from, to } of relationships) {
    const key = pairKey(from.table, to.table);
    pairCount.set(key, (pairCount.get(key) || 0) + 1);
  }

  const entries = new Map(tables.map((table) => [table.name, []]));
  const taken = new Map(
    tables.map((table) => [table.name, new Set(table.columns.map((column) => column.name))])
  );

  const claim = (table, candidates) => {
    const names = taken.get(table.name);
    const chosen = candidates.find((name) => name && !names.has(name));

    if (!chosen) {
      collector.add({
        table: table.name,
        line: table.line,
        message: `Relation '${candidates.filter(Boolean).pop()}' collides with a column or relation of '${table.name}'`,
      });
      return null;
    }

    names.add(chosen);
    return chosen;
  };

  for (const relationship of relationships) {
    const { from, to, kind, composite } = relationship;
    const fromTable = tables.find((table) => table.name == from.table);
    const toTable = tables.find((table) => table.name == to.table);
    const fromExport = exports.get(from.table);
    const toExport = exports.get(to.table);
    const named = from.table == to.table || pairCount.get(pairKey(from.table, to.table)) > 1;
    const relationName = named ? `${from.table}_${from.columns.join("_")}` : null;
    const nameOption = relationName ? `relationName: ${JSON.stringify(relationName)}` : "";

    const column = from.columns[0];
    const stripped = column.replace(/(_id|Id)$/, "");
    const ownKey = claim(
      fromTable,
      composite ? [to.table] : [stripped != column && stripped, `${column}_${to.table}`]
    );

    if (ownKey) {
      const options = [
        `fields: [${from.columns.map((column) => member(fromExport, column)).join(", ")}]`,
        `references: [${to.columns.map((column) => member(toExport, column)).join(", ")}]`,
        nameOption,
      ].filter(Boolean);
      entries
        .get(from.table)
        .push({ helper: "one", text: `${propertyKey(ownKey)}: one(${toExport}, { ${options.join(", ")} })` });
    }

    const otherKey = claim(toTable, [named ? `${from.table}_by_${from.columns.join("_")}` : from.table]);

    if (otherKey) {
      const helper = kind == "one-to-one" ? "one" : "many";
      const options = nameOption ? `, { ${nameOption} }` : "";
      entries.get(to.table).push({ helper, text: `${propertyKey(otherKey)}: ${helper}(${fromExport}${options})` });
    }
  }

  return tables
    .filter((table) => entries.get(table.name).length)
    .map((table) => {
      const list = entries.get(table.name);
      const helpers = ["one", "many"].filter((helper) => list.some((entry) => entry.helper == helper));
      const tableExport = exports.get(table.name);

      return [
        `export const ${tableExport}Relations = relations(${tableExport}, ({ ${helpers.join(", ")} }) => ({`,
        ...list.map((entry) => `  ${entry.text},`),
        "}));",
      ].join("\n");
    });
};
