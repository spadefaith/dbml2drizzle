const fs = require("fs");
const parseSchema = require("./parse-schema");
const toModelAttributes = require("./converter/to-model-attributes");
const generateMigration = require("./migration/generate-migration");
const writeMigration = require("./migration/write-migration");
const generateDbPatch = require("./patch/generate-db-patch");
const writeDbPatch = require("./patch/write-db-patch");
const generateSnapshot = require("./snapshot/create-snapshot");
const generateDiffMigration = require("./migration/generate-diff-migration");
const writeDiffMigration = require("./migration/write-diff-migration");
const writeBaseline = require("./snapshot/write-baseline");
const { DbmlError, DataLossError, SnapshotError } = require("./errors");

/**
 * Frozen models API: defines one Sequelize model per DBML table.
 */
module.exports = (sequelize, DataTypes, srcPath, opts) => {
  const schema = parseSchema(fs.readFileSync(srcPath, "utf8"));

  return schema.tables.map((table) =>
    sequelize.define(
      table.name,
      toModelAttributes(table, schema.relationships, sequelize, DataTypes),
      {
        ...opts,
        indexes: table.indexes,
        comment: table.comment,
      }
    )
  );
};

module.exports.parseSchema = parseSchema;
module.exports.generateMigration = generateMigration;
module.exports.writeMigration = writeMigration;
module.exports.generateDbPatch = generateDbPatch;
module.exports.writeDbPatch = writeDbPatch;
module.exports.generateSnapshot = generateSnapshot;
module.exports.generateDiffMigration = generateDiffMigration;
module.exports.writeDiffMigration = writeDiffMigration;
module.exports.writeBaseline = writeBaseline;
module.exports.DbmlError = DbmlError;
module.exports.DataLossError = DataLossError;
module.exports.SnapshotError = SnapshotError;
