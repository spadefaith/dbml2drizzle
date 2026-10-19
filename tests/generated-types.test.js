const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { generateSchema } = require("../src");

// specs/010-type-correct-self-references/contracts/generated-output.md, "Input".
// No one-to-one self-reference, numeric default on decimal or default: null:
// those strict-TypeScript issues are out of scope (spec 010).
const dbml = `Table accounts {
  id integer [pk]
  created_by integer [ref: > accounts.id, delete: set null]
}

Table departments {
  id integer [pk]
  manager_id integer [ref: > employees.id]
}

Table employees {
  id integer [pk]
  department_id integer [ref: > departments.id]
  boss_id integer
}

Ref: employees.id < employees.boss_id

Table orders {
  id integer [pk]
  account_id integer [ref: > accounts.id]
}
`;

// the command-line tool: TypeScript 7 has no JavaScript compiler API
const tsc = path.join(path.dirname(require.resolve("typescript/package.json")), "bin", "tsc");
const dir = path.join(__dirname, "..", "tmp", "typecheck");

for (const dialect of ["pg", "d1"]) {
  test(`generated ${dialect} schemas with self-references and cycles pass strict TypeScript`, () => {
    // inside the repository, so that drizzle-orm resolves
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${dialect}.ts`), generateSchema(dbml, { dialect, sourceName: "test.dbml" }));
    fs.writeFileSync(
      path.join(dir, `tsconfig.${dialect}.json`),
      JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, module: "esnext", moduleResolution: "bundler", target: "es2022", types: [] },
        files: [`${dialect}.ts`],
      })
    );

    const result = spawnSync(process.execPath, [tsc, "-p", path.join(dir, `tsconfig.${dialect}.json`)], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}
