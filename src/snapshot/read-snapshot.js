const fs = require("fs");
const { SnapshotError } = require("../errors");
const { FORMAT } = require("./create-snapshot");

/**
 * Returns the schema held by snapshot text, or throws SnapshotError
 * (specs/003-incremental-migrations/data-model.md, Snapshot).
 */
function readSnapshot(text, path) {
  let snapshot;

  try {
    snapshot = JSON.parse(text);
  } catch (error) {
    throw new SnapshotError(path, "invalid", `${path} is not a valid snapshot: ${error.message}`);
  }

  const format = snapshot && snapshot.format;

  if (!Number.isInteger(format)) {
    throw new SnapshotError(path, "invalid", `${path} is not a valid snapshot: missing format`);
  }

  if (format > FORMAT) {
    throw new SnapshotError(
      path,
      "unsupported",
      `${path} was written by a newer dbml2sequelize (snapshot format ${format})`
    );
  }

  const schema = snapshot.schema;

  if (format != FORMAT || !schema || !Array.isArray(schema.tables) || !Array.isArray(schema.relationships)) {
    throw new SnapshotError(path, "invalid", `${path} is not a valid snapshot: missing schema`);
  }

  return schema;
}

/**
 * Reads and checks a snapshot file. A missing file points to `baseline`.
 */
function readSnapshotFile(path) {
  if (!fs.existsSync(path)) {
    throw new SnapshotError(
      path,
      "missing",
      `${path} not found. Run "dbml2sequelize baseline <file.dbml>" first.`
    );
  }

  return readSnapshot(fs.readFileSync(path, "utf8"), path);
}

module.exports = { readSnapshot, readSnapshotFile };
