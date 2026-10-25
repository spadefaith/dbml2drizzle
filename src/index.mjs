// @ts-check
// ES module entry: re-exports the CommonJS API (src/index.js). No logic of its own.
export { parseSchema, generateSchema, writeSchema, generateDbPatch, writeDbPatch, dialects, DbmlError } from "./index.js";
export { default } from "./index.js";

// Public types (published in types/index.d.mts)
/** @typedef {import("./index.js").Schema} Schema */
/** @typedef {import("./index.js").Table} Table */
/** @typedef {import("./index.js").Column} Column */
/** @typedef {import("./index.js").ColumnType} ColumnType */
/** @typedef {import("./index.js").DefaultValue} DefaultValue */
/** @typedef {import("./index.js").Index} Index */
/** @typedef {import("./index.js").Check} Check */
/** @typedef {import("./index.js").Enum} Enum */
/** @typedef {import("./index.js").View} View */
/** @typedef {import("./index.js").Relationship} Relationship */
/** @typedef {import("./index.js").PatchEdit} PatchEdit */
/** @typedef {import("./index.js").ErrorEntry} ErrorEntry */
/** @typedef {import("./index.js").DialectId} DialectId */
/** @typedef {import("./index.js").GenerateSchemaOptions} GenerateSchemaOptions */
/** @typedef {import("./index.js").WriteSchemaOptions} WriteSchemaOptions */
/** @typedef {import("./index.js").WriteDbPatchOptions} WriteDbPatchOptions */
