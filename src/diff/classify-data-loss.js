/**
 * Marks the changes that can lose stored data (spec FR-021, research R9).
 * A data-loss change is generated only when data loss is allowed.
 */

const typeText = ({ name, args }) =>
  args.length
    ? `${name}(${args.map((arg) => (typeof arg == "number" ? arg : `'${arg}'`)).join(", ")})`
    : name;

/**
 * Same type with a larger length or precision and every other argument
 * unchanged, e.g. STRING(50) → STRING(100) or DECIMAL(10, 2) → DECIMAL(12, 2).
 */
function isWidening(from, to) {
  return (
    from.name == to.name &&
    from.name != "ENUM" &&
    from.args.length >= 1 &&
    from.args.length == to.args.length &&
    typeof from.args[0] == "number" &&
    typeof to.args[0] == "number" &&
    to.args[0] > from.args[0] &&
    from.args.slice(1).every((arg, index) => arg === to.args[index + 1])
  );
}

function columnLoss({ before, after, enumRebuild, fields }) {
  if (!fields.includes("type")) {
    return false;
  }

  if (enumRebuild) {
    const removed = before.type.args.filter((value) => !after.type.args.includes(value));

    if (!removed.length) {
      return false;
    }

    const quoted = removed.map((value) => `'${value}'`).join(", ");
    return removed.length == 1 ? `enum value ${quoted} removed` : `enum values ${quoted} removed`;
  }

  return isWidening(before.type, after.type) ? false : `type changes from ${typeText(before.type)} to ${typeText(after.type)}`;
}

/**
 * Sets `dataLoss` on every change of the change set to false or a message,
 * and fills `changeSet.dataLoss` with the changes that can lose data.
 */
module.exports = function classifyDataLoss(changeSet) {
  const { changes } = changeSet;
  const has = (kind, table) => changes.some((change) => change.kind == kind && (!table || change.table == table));

  for (const change of changes) {
    switch (change.kind) {
      case "dropTable":
        change.dataLoss = "table removed";
        has("createTable") &&
          (change.dataLoss += ` (if it was renamed, add renamed_from: '${change.table}' to the new table)`);
        break;
      case "removeColumn":
        change.dataLoss = "column removed";
        has("addColumn", change.table) &&
          (change.dataLoss += ` (if it was renamed, add renamed_from: '${change.column}' to the new column)`);
        break;
      case "changeColumn":
        change.dataLoss = columnLoss(change);
        break;
      case "changePrimaryKey":
        // a key only re-added under a renamed table's name is not a change
        change.dataLoss =
          change.keyChanged && `primary key changes from (${change.before.join(", ")}) to (${change.after.join(", ")})`;
        break;
    }
  }

  changeSet.dataLoss = changes.filter((change) => change.dataLoss);
  return changeSet;
};

module.exports.isWidening = isWidening;
