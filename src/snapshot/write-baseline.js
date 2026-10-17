const fs = require("fs");
const path = require("path");
const generateSnapshot = require("./create-snapshot");

const SNAPSHOT_NAME = "dbml2sequelize-snapshot.json";

/**
 * Records the current .dbml file as the snapshot without generating a
 * migration, replacing an existing snapshot (spec FR-002). Returns the
 * snapshot path.
 */
module.exports = function writeBaseline(dbmlPath, opts = {}) {
  const { outDir = "migrations", snapshotPath = path.join(outDir, SNAPSHOT_NAME) } = opts;
  const snapshot = generateSnapshot(fs.readFileSync(dbmlPath, "utf8"), { source: path.basename(dbmlPath) });

  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, snapshot);

  return snapshotPath;
};

module.exports.SNAPSHOT_NAME = SNAPSHOT_NAME;
