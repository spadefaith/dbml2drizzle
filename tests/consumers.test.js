const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { installPacked } = require("./helpers");

const EXPORTS = ["parseSchema", "generateSchema", "writeSchema", "generateDbPatch", "writeDbPatch", "dialects", "DbmlError"];

/**
 * Writes `files` ({ name: text }) into `dir`.
 */
function writeFiles(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), text);
  }
}

/**
 * Runs `script` with Node.js in `cwd` and returns the JSON it prints.
 */
function runJson(cwd, script) {
  const result = spawnSync(process.execPath, [script], { cwd, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("an ES module project imports every export by name, from the ES module entry", () => {
  const dir = installPacked("esm");

  writeFiles(dir, {
    "package.json": '{ "type": "module" }\n',
    "run.mjs": `import { createRequire } from "node:module";
import * as api from "dbml2drizzle";
import api2 from "dbml2drizzle";

const cjs = createRequire(import.meta.url)("dbml2drizzle");
let crossInstanceof = false;

try {
  api.generateSchema("Table a {\\n  b money\\n}\\n");
} catch (error) {
  crossInstanceof = error instanceof cjs.DbmlError;
}

console.log(JSON.stringify({
  resolved: import.meta.resolve("dbml2drizzle"),
  same: ${JSON.stringify(EXPORTS)}.every((name) => name in api && api[name] === cjs[name]),
  defaultSame: api2 === cjs,
  crossInstanceof,
  dialects: api.dialects,
}));
`,
    "dynamic.cjs": `import("dbml2drizzle").then((api) => {
  console.log(JSON.stringify({ same: api.generateSchema === require("dbml2drizzle").generateSchema }));
});
`,
  });

  const result = runJson(dir, "run.mjs");

  assert.match(result.resolved, /\/node_modules\/dbml2drizzle\/src\/index\.mjs$/);
  assert.equal(result.same, true);
  assert.equal(result.defaultSame, true);
  assert.equal(result.crossInstanceof, true);
  assert.deepEqual(result.dialects, ["pg", "d1"]);
  assert.deepEqual(runJson(dir, "dynamic.cjs"), { same: true });
});

test("a CommonJS project keeps require(), internal paths and the command-line tool", () => {
  const dir = installPacked("cjs");

  writeFiles(dir, {
    "run.cjs": `console.log(JSON.stringify({
  exports: Object.keys(require("dbml2drizzle")).sort(),
  internal: typeof require("dbml2drizzle/src/parse-schema.js"),
  pkg: require("dbml2drizzle/package.json").name,
}));
`,
  });

  assert.deepEqual(runJson(dir, "run.cjs"), {
    exports: [...EXPORTS].sort(),
    internal: "function",
    pkg: "dbml2drizzle",
  });

  const cli = spawnSync(process.execPath, ["node_modules/dbml2drizzle/bin/dbml2drizzle.js", "--help"], { cwd: dir, encoding: "utf8" });

  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /dbml2drizzle schema <file\.dbml>/);
});

// specs/009-esm-entry-and-types/contracts/public-api.md, "Consumer type checks"
const consumerTs = `import { generateSchema, parseSchema, dialects, DbmlError } from "dbml2drizzle";
import type { DialectId, ErrorEntry, Schema } from "dbml2drizzle";

const text: string = generateSchema("Table a {\\n  id int [pk]\\n}\\n", { dialect: "d1" });
// @ts-expect-error: not a registered dialect
generateSchema(text, { dialect: "mysql" });

const schema: Schema = parseSchema("Table a {\\n  id int [pk]\\n}\\n");
const targets: DialectId[] = dialects;
let failure: DbmlError | undefined;

try {
  generateSchema("Table a {\\n  b money\\n}\\n");
} catch (error) {
  if (error instanceof DbmlError) {
    failure = error;
    const entry: ErrorEntry = error.errors[0];
    const line: number | undefined = entry.line;
  }
}
`;

const tsc = path.join(path.dirname(require.resolve("typescript/package.json")), "bin", "tsc");

for (const [kind, type, module] of [["types-cjs", "commonjs", "node16"], ["types-esm", "module", "nodenext"]]) {
  test(`a TypeScript project (${type}) gets the public API's types`, () => {
    const dir = installPacked(kind);

    writeFiles(dir, {
      "package.json": JSON.stringify({ type }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: { module, moduleResolution: module, target: "es2022", strict: true, noEmit: true, skipLibCheck: false, types: [] },
        files: ["consumer.ts"],
      }),
      "consumer.ts": consumerTs,
    });

    // the command-line tool: TypeScript 7 has no JavaScript compiler API
    const result = spawnSync(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: dir, encoding: "utf8" });

    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}
