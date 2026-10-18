const INTEGER_TYPES = ["integer", "smallint", "bigint"];

/**
 * Whether `increment` on `column` is valid on D1, reporting it to
 * `collector` when not: SQLite auto-increments only the table's single
 * integer primary key.
 */
module.exports = function checkIncrement(column, location, collector, table) {
  const valid =
    !column.autoIncrement ||
    (column.primaryKey &&
      table.columns.filter((item) => item.primaryKey).length == 1 &&
      INTEGER_TYPES.includes(column.type.name));

  valid || collector.add({ ...location, message: "increment on D1 needs the table's single integer primary key" });
  return valid;
};
