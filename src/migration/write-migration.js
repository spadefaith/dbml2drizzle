const fs = require("fs");
const path = require("path");
const generateMigration = require("./generate-migration");
const generateSnapshot = require("../snapshot/create-snapshot");
const { SNAPSHOT_NAME } = require("../snapshot/write-baseline");
const { SnapshotError } = require("../errors");

function timestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds())
  );
}

/**
 * Reads a .dbml file and writes <outDir>/<YYYYMMDDHHmmss>-<name>.js, then
 * the snapshot that incremental migrations start from. An existing snapshot
 * is only replaced with `overwriteSnapshot`, so pending DBML changes are
 * never folded into it unnoticed (spec FR-003a). Nothing is written when
 * the DBML has errors. Returns the migration path.
 */
module.exports = function writeMigration(dbmlPath, opts = {}) {
  const {
    outDir = "migrations",
    name = "init-schema",
    date = new Date(),
    snapshotPath = path.join(outDir, SNAPSHOT_NAME),
    overwriteSnapshot = false,
  } = opts;

  if (!overwriteSnapshot && fs.existsSync(snapshotPath)) {
    throw new SnapshotError(
      snapshotPath,
      "exists",
      `${snapshotPath} already exists. Use "dbml2sequelize diff" for schema changes, or pass --overwrite-snapshot to start over.`
    );
  }

  const text = fs.readFileSync(dbmlPath, "utf8");
  const source = path.basename(dbmlPath);
  const code = generateMigration(text, { source });
  const snapshot = generateSnapshot(text, { source });

  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `${timestamp(date)}-${name}.js`);
  fs.writeFileSync(filePath, code);

  try {
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, snapshot);
  } catch (error) {
    fs.rmSync(filePath, { force: true });
    throw error;
  }

  return filePath;
};

module.exports.timestamp = timestamp;
