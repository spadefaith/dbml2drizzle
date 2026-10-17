const parseSchema = require("./parse-schema");
const generateSchema = require("./generator/generate-schema");
const writeSchema = require("./generator/write-schema");
const generateDbPatch = require("./patch/generate-db-patch");
const writeDbPatch = require("./patch/write-db-patch");
const { dialects } = require("./dialects");
const { DbmlError } = require("./errors");

module.exports = {
  parseSchema,
  generateSchema,
  writeSchema,
  generateDbPatch,
  writeDbPatch,
  dialects,
  DbmlError,
};
