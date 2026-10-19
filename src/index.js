// @ts-check
const parseSchema = require("./parse-schema");
const generateSchema = require("./generator/generate-schema");
const writeSchema = require("./generator/write-schema");
const generateDbPatch = require("./patch/generate-db-patch");
const writeDbPatch = require("./patch/write-db-patch");
const { dialects } = require("./dialects");
const { DbmlError } = require("./errors");

// Public types (published in types/index.d.ts)
/** @typedef {import("./types").Schema} Schema */
/** @typedef {import("./types").Table} Table */
/** @typedef {import("./types").Column} Column */
/** @typedef {import("./types").ColumnType} ColumnType */
/** @typedef {import("./types").DefaultValue} DefaultValue */
/** @typedef {import("./types").Index} Index */
/** @typedef {import("./types").Check} Check */
/** @typedef {import("./types").Enum} Enum */
/** @typedef {import("./types").Relationship} Relationship */
/** @typedef {import("./types").PatchEdit} PatchEdit */
/** @typedef {import("./types").ErrorEntry} ErrorEntry */
/** @typedef {import("./dialects").DialectId} DialectId */
/** @typedef {import("./generator/generate-schema").GenerateSchemaOptions} GenerateSchemaOptions */
/** @typedef {import("./generator/write-schema").WriteSchemaOptions} WriteSchemaOptions */
/** @typedef {import("./patch/write-db-patch").WriteDbPatchOptions} WriteDbPatchOptions */
// DbmlError as a type too: the declarations describe module.exports as an object
/** @typedef {InstanceType<typeof DbmlError>} DbmlError */

// Keep this an object literal of shorthand names: Node.js reads the names
// from it so that src/index.mjs can re-export them to ES module projects.
module.exports = {
  parseSchema,
  generateSchema,
  writeSchema,
  generateDbPatch,
  writeDbPatch,
  dialects,
  DbmlError,
};
