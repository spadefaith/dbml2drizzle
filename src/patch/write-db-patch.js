const fs = require("fs");
const path = require("path");
const generateDbPatch = require("./generate-db-patch");

/**
 * Reads a .dbml file and writes its dbdocs-ready copy, by default
 * `<dir>/<base name>-patch.dbml` (db.dbml → db-patch.dbml). Replaces an
 * existing file, never touches the source, and writes nothing when the DBML
 * has errors. Returns the written path.
 */
module.exports = function writeDbPatch(dbmlPath, opts = {}) {
  const { dir, name } = path.parse(dbmlPath);
  const { outPath = path.join(dir, `${name}-patch.dbml`) } = opts;

  const patch = generateDbPatch(fs.readFileSync(dbmlPath, "utf8"));

  if (path.resolve(outPath) == path.resolve(dbmlPath)) {
    throw new Error("The output path must differ from the source DBML file");
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, patch);

  return outPath;
};
