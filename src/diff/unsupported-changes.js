/**
 * Differences Sequelize's queryInterface cannot express, forward or in the
 * reverse step (spec FR-016, research R6, R7, R9). Each one is reported as a
 * DbmlError entry; none of them is ever generated.
 */

const MESSAGES = {
  noteAdded: "Adding a note to an existing column is not supported by Sequelize migrations",
  noteRemoved: "Removing a column note is not supported by Sequelize migrations",
  tableNote: "Changing a table note is not supported by Sequelize migrations",
  increment: "Changing an auto-increment column is not supported by Sequelize migrations",
};

const FOOTER = [
  "To apply a change Sequelize cannot express without losing other changes:",
  "  1. undo that edit in the DBML,",
  '  2. run "dbml2sequelize diff" for the remaining changes,',
  "  3. redo the edit,",
  "  4. write its migration by hand,",
  '  5. run "dbml2sequelize baseline".',
].join("\n");

const same = (a, b) => JSON.stringify(a) == JSON.stringify(b);
const nullable = (column) => !(column.allowNull === false || column.primaryKey);

/**
 * Adds an entry to `collector` for every unsupported difference between
 * tables present on both sides. Returns true when any was found.
 */
function findUnsupportedChanges(before, after, collector) {
  let found = false;
  const add = (error) => {
    found = true;
    collector.add(error);
  };

  for (const table of after.tables) {
    const old = before.tables.find((item) => item.name == table.name);

    if (!old) {
      continue;
    }

    if ((old.comment || "") != (table.comment || "")) {
      add({ table: table.name, line: table.line, message: MESSAGES.tableNote });
    }

    for (const column of table.columns) {
      const previous = old.columns.find((item) => item.name == column.name);

      if (!previous) {
        continue;
      }

      const location = { table: table.name, column: column.name, line: column.line };

      if (!previous.comment && column.comment) {
        add({ ...location, message: MESSAGES.noteAdded });
      } else if (previous.comment && !column.comment) {
        add({ ...location, message: MESSAGES.noteRemoved });
      }

      const incrementChanged = Boolean(previous.autoIncrement) != Boolean(column.autoIncrement);
      const incrementColumnChanged =
        previous.autoIncrement &&
        column.autoIncrement &&
        (!same(previous.type, column.type) ||
          nullable(previous) != nullable(column) ||
          !same(previous.defaultValue, column.defaultValue) ||
          (previous.comment || "") != (column.comment || ""));

      if (incrementChanged || incrementColumnChanged) {
        add({ ...location, message: MESSAGES.increment });
      }
    }
  }

  return found;
}

module.exports = findUnsupportedChanges;
module.exports.FOOTER = FOOTER;
module.exports.MESSAGES = MESSAGES;
