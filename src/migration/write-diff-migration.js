const fs = require("fs");
const path = require("path");
const generateDiffMigration = require("./generate-diff-migration");
const { timestamp } = require("./write-migration");
const { readSnapshotFile } = require("../snapshot/read-snapshot");
const { SNAPSHOT_NAME } = require("../snapshot/write-baseline");

/**
 * Reads the snapshot and a .dbml file and, when they differ, writes
 * <outDir>/<YYYYMMDDHHmmss>-<name>.js and then replaces the snapshot.
 * Returns the migration path, or null when there are no changes (nothing is
 * written then). If the snapshot cannot be written, the migration is
 * removed again so neither exists without the other (research R11).
 */
module.exports = function writeDiffMigration(dbmlPath, opts = {}) {
  const {
    outDir = "migrations",
    name = "schema-update",
    snapshotPath = path.join(outDir, SNAPSHOT_NAME),
    allowDataLoss = false,
    date = new Date(),
  } = opts;

  readSnapshotFile(snapshotPath);

  const { code, snapshot } = generateDiffMigration(
    fs.readFileSync(snapshotPath, "utf8"),
    fs.readFileSync(dbmlPath, "utf8"),
    {
      source: path.basename(dbmlPath),
      snapshotSource: path.basename(snapshotPath),
      allowDataLoss,
    }
  );

  if (code == null) {
    return null;
  }

  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `${timestamp(date)}-${name}.js`);
  fs.writeFileSync(filePath, code);

  try {
    fs.writeFileSync(snapshotPath, snapshot);
  } catch (error) {
    fs.rmSync(filePath, { force: true });
    throw error;
  }

  return filePath;
};
