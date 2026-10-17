const sideName = ({ table, columns }) =>
  columns.length == 1 ? `${table}.${columns[0]}` : `${table}.(${columns.join(", ")})`;

/**
 * Turns raw references (inline or standalone, as written) into
 * data-model.md Relationships, where `from` always holds the foreign key.
 *
 * - `>`: from = left side, to = right side
 * - `<`: from = right side, to = left side
 * - `-`: like `>`, one-to-one (the `from` column(s) become unique)
 *
 * Reports unknown tables/columns, mismatched composite sides and
 * conflicting declarations. Sets `unique: true` on the `from` column of
 * single-column one-to-one relationships.
 */
module.exports = function resolveRelationships(rawRefs, tables, collector) {
  const tableByName = new Map(tables.map((table) => [table.name, table]));
  const relationships = [];

  const checkSide = (side, location) => {
    const table = tableByName.get(side.table);

    if (!table) {
      collector.add({ ...location, message: `References unknown table '${side.table}'` });
      return false;
    }

    const missing = side.columns.find(
      (column) => !table.columns.some((item) => item.name == column)
    );

    if (missing) {
      collector.add({ ...location, message: `References unknown column '${side.table}.${missing}'` });
      return false;
    }

    return true;
  };

  for (const ref of rawRefs) {
    const { op, line, form } = ref;
    const [from, to] = op == "<" ? [ref.to, ref.from] : [ref.from, ref.to];
    const location = { table: ref.from.table, column: ref.from.columns.join(", "), line };

    if (from.columns.length != to.columns.length) {
      collector.add({ ...location, message: "Composite reference sides have different column counts" });
      continue;
    }

    if (!checkSide(ref.from, location) || !checkSide(ref.to, location)) {
      continue;
    }

    const relationship = {
      from: { table: from.table, columns: [...from.columns] },
      to: { table: to.table, columns: [...to.columns] },
      kind: op == "-" ? "one-to-one" : "many-to-one",
      composite: from.columns.length > 1,
      ...(ref.onDelete && { onDelete: ref.onDelete }),
      ...(ref.onUpdate && { onUpdate: ref.onUpdate }),
      declaredAt: [{ line, form }],
    };

    const existing = relationships.find(
      (item) =>
        sideName(item.from) == sideName(relationship.from) &&
        sideName(item.to) == sideName(relationship.to)
    );

    if (!existing) {
      relationships.push(relationship);
      continue;
    }

    const same =
      existing.kind == relationship.kind &&
      existing.onDelete == relationship.onDelete &&
      existing.onUpdate == relationship.onUpdate;

    if (same) {
      existing.declaredAt.push({ line, form });
    } else {
      collector.add({
        ...location,
        message: `Conflicting declarations of ${sideName(from)} → ${sideName(to)} (lines ${existing.declaredAt[0].line} and ${line})`,
      });
    }
  }

  for (const relationship of relationships) {
    if (relationship.kind == "one-to-one" && !relationship.composite) {
      const table = tableByName.get(relationship.from.table);
      const column = table.columns.find((item) => item.name == relationship.from.columns[0]);
      column.unique = true;
    }
  }

  return relationships;
};
