// @ts-check
/** @typedef {import("./types").ErrorEntry} ErrorEntry */

/**
 * Every problem found in one DBML file, reported together. An optional
 * footer is appended after an empty line.
 */
class DbmlError extends Error {
  /**
   * @param {ErrorEntry[]} errors
   * @param {string} [footer]
   */
  constructor(errors, footer) {
    const lines = errors.map(formatError).join("\n");
    super(footer ? `${lines}\n\n${footer}` : lines);
    this.name = "DbmlError";
    this.errors = errors;
  }
}

/**
 * One problem as `line <n>: <table>.<column>: <message>` (parts that are known).
 *
 * @param {ErrorEntry} error
 * @returns {string}
 */
function formatError({ message, table, column, line }) {
  const location = [table, column].filter(Boolean).join(".");
  const parts = [];

  line != undefined && parts.push(`line ${line}`);
  location && parts.push(location);
  parts.push(message);

  return parts.join(": ");
}

/**
 * @returns {import("./types").Collector}
 */
function createCollector() {
  /** @type {ErrorEntry[]} */
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

module.exports = { DbmlError, createCollector, formatError };
