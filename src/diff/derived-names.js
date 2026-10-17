/**
 * Names the database gives, or the migrations give explicitly, to objects
 * the DBML does not name (specs/003-incremental-migrations/research.md R4).
 * Incremental migrations use them to find those objects again.
 */

const foreignKeyName = (table, columns) => `${table}_${columns.join("_")}_fkey`;
const uniqueName = (table, columns) => `${table}_${columns.join("_")}_key`;
const primaryKeyName = (table) => `${table}_pkey`;
const indexName = (table, fields) => `${table}_${fields.join("_")}`;
const enumName = (table, column) => `enum_${table}_${column}`;

module.exports = { foreignKeyName, uniqueName, primaryKeyName, indexName, enumName };
