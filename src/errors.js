/**
 * Every problem found in one DBML file, reported together. An optional
 * footer is appended after an empty line.
 */
class DbmlError extends Error {
  constructor(errors, footer) {
    const lines = errors.map(formatError).join("\n");
    super(footer ? `${lines}\n\n${footer}` : lines);
    this.name = "DbmlError";
    this.errors = errors;
  }
}

/**
 * Changes that can lose data, refused because data loss was not allowed.
 * `changes` is [{ table, column?, message }].
 */
class DataLossError extends Error {
  constructor(changes) {
    super(
      [
        "Refused: these changes can lose data (pass --allow-data-loss to generate them):",
        ...changes.map(
          ({ table, column, message }) => `${[table, column].filter(Boolean).join(".")}: ${message}`
        ),
      ].join("\n")
    );
    this.name = "DataLossError";
    this.changes = changes;
  }
}

/**
 * A snapshot file that is missing, unreadable, of an unsupported format, or
 * that already exists where it must not be overwritten.
 */
class SnapshotError extends Error {
  constructor(path, reason, message) {
    super(message);
    this.name = "SnapshotError";
    this.path = path;
    this.reason = reason;
  }
}

function formatError({ message, table, column, line }) {
  const location = [table, column].filter(Boolean).join(".");
  const parts = [];

  line != undefined && parts.push(`line ${line}`);
  location && parts.push(location);
  parts.push(message);

  return parts.join(": ");
}

function createCollector() {
  const errors = [];

  return {
    add(error) {
      errors.push(error);
    },
    hasErrors() {
      return errors.length > 0;
    },
    throwIfAny(footer) {
      if (errors.length) {
        const sorted = [...errors].sort((a, b) => (a.line || 0) - (b.line || 0));
        throw new DbmlError(sorted, footer);
      }
    },
  };
}

module.exports = { DbmlError, DataLossError, SnapshotError, createCollector, formatError };
