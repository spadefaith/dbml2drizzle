// @ts-check

/**
 * Whether a reference leads back to its own table: from `fromTable` to
 * `toTable` where `toTable` reaches `fromTable` again through the schema's
 * references (a self-reference, or a cycle through other tables). TypeScript
 * cannot infer the type of tables whose references form such a cycle, so
 * those references get an explicit callback type (see
 * specs/010-type-correct-self-references/research.md). Every relationship,
 * single-column or composite, is an edge.
 *
 * @param {import("../types").Relationship[]} relationships
 * @returns {(fromTable: string, toTable: string) => boolean}
 */
module.exports = function leadsBack(relationships) {
  /** @type {Map<string, Set<string>>} */
  const edges = new Map();

  for (const { from, to } of relationships) {
    edges.has(from.table) || edges.set(from.table, new Set());
    /** @type {Set<string>} */ (edges.get(from.table)).add(to.table);
  }

  return (fromTable, toTable) => {
    const visited = new Set();
    const pending = [toTable];

    while (pending.length) {
      const table = /** @type {string} */ (pending.pop());

      if (table == fromTable) {
        return true;
      }

      if (!visited.has(table)) {
        visited.add(table);
        pending.push(...(edges.get(table) || []));
      }
    }

    return false;
  };
};
