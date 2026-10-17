/**
 * Orders tables so each one is created after the tables it references,
 * keeping file order otherwise. Self-references need no ordering. When
 * tables reference each other in a cycle, the earliest remaining table is
 * created anyway and its foreign keys to not-yet-created tables are returned
 * in `deferred` ({ table, column }) to be added after all tables exist.
 *
 * Composite relationships are ignored here: they are always added after all
 * tables exist.
 */
module.exports = function sortTables({ tables, relationships }) {
  const singles = relationships.filter((relationship) => !relationship.composite);
  const referencesOf = (table) =>
    singles
      .filter((relationship) => relationship.from.table == table.name && relationship.to.table != table.name)
      .map((relationship) => ({ column: relationship.from.columns[0], target: relationship.to.table }));

  const created = new Set();
  const ordered = [];
  const deferred = [];
  const remaining = [...tables];

  while (remaining.length) {
    let index = remaining.findIndex((table) =>
      referencesOf(table).every(({ target }) => created.has(target))
    );

    if (index == -1) {
      index = 0;
      for (const { column, target } of referencesOf(remaining[0])) {
        created.has(target) || deferred.push({ table: remaining[0].name, column });
      }
    }

    const [table] = remaining.splice(index, 1);
    created.add(table.name);
    ordered.push(table);
  }

  return { ordered, deferred };
};
