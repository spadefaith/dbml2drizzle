# Changelog

## Unreleased

### Added

- CHECK constraints: the column setting ``check: `<expression>` `` (named `<table>_<column>_check`)
  and a table `checks { }` block with one `` `<expression>` [name: '<name>'] `` per line. Each
  becomes `check(name, sql`…`)` in the generated schema; `db-patch.dbml` keeps them unchanged.
- Expression indexes: backtick expressions in `indexes { }`, alone or among columns (a `name:` is
  required). They become `sql`…`` index parts; `db-patch.dbml` keeps them unchanged.
- Partial indexes: the index setting ``where: `<condition>` `` becomes `.where(sql`…`)`. In
  `db-patch.dbml` the condition moves into the entry's note, since standard DBML has no `where`.

- Shared enums: top-level `Enum name { … }` blocks, used by any number of columns through their
  type name. Each becomes one `pgEnum` named as the block; block and value notes become its JSDoc.
  In `db-patch.dbml` a `Note` inside an `Enum` moves onto its first value, since standard DBML
  rejects a note on an `Enum`.

### Changed

- The error `Expression indexes are not supported` is gone.
- The error `Enum blocks are not supported; use an inline enum('a','b') type` is gone.
- `parseSchema()` returns an `enums` array.

## 3.0.0

The package is renamed **dbml2drizzle**. It now generates a Drizzle ORM schema from DBML, and
drizzle-kit takes over migrations: generating, diffing and confirming renames.

### Breaking

- Renamed from `dbml2sequelize` to `dbml2drizzle`. The command-line tool is now `dbml2drizzle`.
- Removed the Sequelize outputs:
  - the `migrate`, `diff` and `baseline` commands;
  - `generateMigration`, `writeMigration`, `generateDiffMigration`, `writeDiffMigration`,
    `generateSnapshot` and `writeBaseline`;
  - the snapshot file;
  - `DataLossError`, `SnapshotError` and exit code `3`;
  - the frozen models API (the default export).
- Removed `renamed_from`. It is now an error, because renames are confirmed in drizzle-kit
  generate's prompt.
- `parseSchema` now returns canonical DBML type names (`varchar`, `timestamptz`, `date`, …)
  instead of Sequelize data type names.
- `sequelize`, `sequelize-auto` and `pg` are no longer dependencies. The package has no runtime
  dependencies.

### Added

- `dbml2drizzle schema <file.dbml> [--out] [--dialect]`, `generateSchema` and `writeSchema`. They
  write a deterministic `drizzle-orm/pg-core` schema with:
  - every table, column, type, default, primary key (single and composite), unique column, index
    and foreign key (single and composite, with actions);
  - enums as `pgEnum`;
  - `increment` as an identity column;
  - notes as JSDoc comments.
- `relations()` are generated on both sides of every DBML reference.
- Target dialects: `pg` for now, with `dialects` listing the supported targets. Each database is
  its own module, so MySQL and SQLite can be added later.

### Changed

- `timestamp` is now a timestamp without time zone, and `varchar` without a length is unbounded.
  Both are converted as written. See "Moving from dbml2sequelize" in the README.

## 2.1.0

Incremental migrations: after the initial migration, `diff` generates one migration per schema
change, using only Sequelize `queryInterface` operations.

### Added

- `dbml2sequelize diff <file.dbml>` and `writeDiffMigration` / `generateDiffMigration`: compare
  `db.dbml` with the snapshot and write a migration with only the differences — tables, columns,
  types, nullability, defaults, column notes, unique rules, enum values, primary keys, indexes and
  foreign keys — with a `down` that undoes every step. Prints `No changes.` when there is nothing
  to do.
- The snapshot, `migrations/dbml2sequelize-snapshot.json`, and `dbml2sequelize baseline` /
  `writeBaseline` / `generateSnapshot` to record it without a migration.
- `renamed_from: '<old name>'` on tables and columns, generated as `renameTable` /
  `renameColumn`. Constraints, indexes and enum types named after the old name are re-added
  under the new one. It is removed from `db-patch.dbml` and ignored by the initial migration and
  the models API.
- Data-loss protection: removing a table or column, a type change other than widening, removing an
  enum value, or changing a primary key is refused unless `--allow-data-loss` is passed. New exit
  code `3`.
- Changes Sequelize cannot express (removing or newly adding a column note, changing a table note
  on an existing table, auto-increment changes) are reported as errors, with the steps to apply
  them by hand.
- `DataLossError` and `SnapshotError` exports.

### Changed

- `migrate` / `writeMigration` also write the snapshot, and refuse to run (exit `2`, nothing
  written) when a snapshot already exists, unless `--overwrite-snapshot` / `overwriteSnapshot`
  is passed. Its stdout is still only the migration path.
- The initial migration's `down` drops PostgreSQL enum types with `queryInterface.dropEnum`
  instead of a raw `DROP TYPE IF EXISTS` query. The effect is the same; generated migrations now
  contain no SQL.

## 2.0.0

dbml2sequelize now generates Sequelize migrations. The models API from 1.x still works but is
frozen: it gets parsing fixes, no new features.

### Added

- `dbml2sequelize migrate <file.dbml>` and `writeMigration` / `generateMigration`: one
  sequelize-cli migration with tables in dependency order, foreign keys and their actions,
  composite foreign keys, composite primary keys, indexes, table and column comments, a
  transaction per step, and a `down` that also drops PostgreSQL enum types.
- `dbml2sequelize patch <file.dbml>` and `writeDbPatch` / `generateDbPatch`: a copy of the DBML
  that dbdocs and other standard DBML tools accept.
- `parseSchema` and `DbmlError` exports.
- Standalone `Ref:` lines (including `Ref name:`, `Ref { }` blocks and composite references) and
  `Note { }` table blocks.
- Triple-quoted (`'''…'''`) notes that span several lines.

### Changed in the models API output

These come from the shared parser and fix silent schema loss. If you relied on the old output,
check these:

- `json` and `jsonb` columns are now defined (they were silently dropped).
- Table notes in `Note: { ... }` blocks now become the model's table comment (they were lost).
- `text` columns keep all their settings (the first setting used to be dropped).
- Comments no longer contain `(comma)` placeholders.
- String defaults no longer keep their quotes (`'active'` → `active`).
- Boolean defaults `1` / `0` become `true` / `false`.
- `ref: -` (one-to-one) columns are now unique.
- `ref: <` puts the foreign key on the other column, as DBML intends (it was put on the column
  where the ref was written).
- `onDelete` / `onUpdate` values are upper-case (`SET NULL`), which Sequelize treats the same.
- An index entry marked `[pk]` now makes those columns the primary key instead of creating a
  unique index named `<columns>_pk`.
- Unnamed indexes now carry their name explicitly (`<table>_<column>_...`, the name Sequelize
  generated before).
- `//` comment lines are ignored (they could become bogus attributes).
- DBML problems — unknown types or settings, `enum()` without values, references to missing tables
  or columns, `Enum` blocks, and more — now throw one `DbmlError` listing all of them, instead of
  being skipped or throwing on the first one.
- `TableGroup` blocks no longer produce a model.
