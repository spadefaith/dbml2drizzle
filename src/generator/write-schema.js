const fs = require("fs");
const path = require("path");
const generateSchema = require("./generate-schema");

/**
 * Reads a .dbml file and writes its Drizzle schema, by default
 * `<dir>/<base name>.schema.ts` (db.dbml → db.schema.ts). Replaces an
 * existing file, never touches the source, and writes nothing when the DBML
 * has errors. Returns the written path.
 */
module.exports = function writeSchema(dbmlPath, opts = {}) {
  const { dir, name, base } = path.parse(dbmlPath);
  const { dialect = "pg", outPath = path.join(dir, `${name}.schema.ts`) } = opts;

  if (path.resolve(outPath) == path.resolve(dbmlPath)) {
    throw new Error("The output path must differ from the source DBML file");
  }

  const schema = generateSchema(fs.readFileSync(dbmlPath, "utf8"), { dialect, sourceName: base });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, schema);

  return outPath;
};
