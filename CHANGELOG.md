# Changelog

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
