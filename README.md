# dbml2drizzle

Generate a [Drizzle ORM](https://orm.drizzle.team/) schema from a [DBML](https://www.dbml.org/) schema, plus a copy of that DBML that [dbdocs](https://dbdocs.io/) and other standard DBML tools accept.

You keep the database design in `db.dbml`. This package turns it into a `schema.ts` file, and [drizzle-kit](https://orm.drizzle.team/docs/kit-overview) compares that file with its last snapshot to write each migration.

```text
            ┌──────────────────────────────┐
            │  db.dbml  (source of truth)  │
            └──────────────┬───────────────┘
                           │  one parser
              ┌────────────┴─────────────┐
              ▼                          ▼
      db.schema.ts                 db-patch.dbml
  (dbml2drizzle schema)        (dbml2drizzle patch → dbdocs)
              │
              ▼
   drizzle-kit generate  →  migrations
```

> **Upgrading from dbml2sequelize?** Version 3.0.0 is a breaking change. The package was renamed and the Sequelize migrations and models API were removed. See [Moving from dbml2sequelize](#moving-from-dbml2sequelize) and [CHANGELOG.md](CHANGELOG.md).

## Table of Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Command line](#command-line)
- [JavaScript API](#javascript-api)
- [DBML reference](#dbml-reference)
- [The generated schema](#the-generated-schema)
- [Relations](#relations)
- [Renaming a table or column](#renaming-a-table-or-column)
- [Moving from dbml2sequelize](#moving-from-dbml2sequelize)
- [Target databases](#target-databases)
- [SQLite](#sqlite)
- [Errors](#errors)
- [Converted as written](#converted-as-written)
- [Documentation with dbdocs](#documentation-with-dbdocs)
- [Contributing to this package](#contributing-to-this-package)

## Installation

```bash
npm install --save-dev dbml2drizzle
npm install drizzle-orm && npm install --save-dev drizzle-kit
```

The package needs Node.js 20 or later and has no runtime dependencies. The generated schema targets drizzle-orm 0.45.x and drizzle-kit 0.31.x.

## Quick start

```bash
npx dbml2drizzle schema db/db.dbml --out src/db/schema.ts
```

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
```

```bash
npx drizzle-kit generate     # writes a migration with the changes since the last one
npx drizzle-kit migrate      # applies it
```

After each change to `db.dbml`, run `dbml2drizzle schema` again, then `drizzle-kit generate`. Review the generated SQL before applying it.

## Command line

```text
dbml2drizzle schema <file.dbml> [--out <file.ts>] [--dialect <target>]
dbml2drizzle patch <file.dbml> [--out <file>]
dbml2drizzle --help
```

| Command | Writes | Default output |
|---|---|---|
| `schema` | The Drizzle schema for the target (`--dialect pg` or `--dialect sqlite`, default `pg`) | `<dir>/<name>.schema.ts` (`db.dbml` → `db.schema.ts`) |
| `patch` | A dbdocs-ready copy of the DBML | `<dir>/<name>-patch.dbml` |

- On success, the written path is printed.
- An existing output file is replaced.
- The source DBML is never written to, and the output path must differ from it.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | The DBML has errors, which are listed on stderr one per line. Nothing is written. |
| `2` | Usage problem: unknown command, missing file, unknown option or unsupported `--dialect`. |

## JavaScript API

The package works in CommonJS and ES module projects:

```js
// CommonJS
const { generateSchema, writeSchema, generateDbPatch, writeDbPatch, parseSchema, dialects, DbmlError } = require("dbml2drizzle");

// ES modules
import { generateSchema, writeSchema, generateDbPatch, writeDbPatch, parseSchema, dialects, DbmlError } from "dbml2drizzle";

// either, loaded on demand
const { generateSchema } = await import("dbml2drizzle");
```

Both give the same objects, so `error instanceof DbmlError` holds however the package was loaded.

**TypeScript**: type declarations are included, for projects that compile to CommonJS or to ES modules. `dialect` is typed as `"pg" | "sqlite"`, `parseSchema` returns a typed `Schema`, and `DbmlError` works as a value (`instanceof`) and as a type. The types are exported too:

```ts
import { generateSchema, DbmlError } from "dbml2drizzle";
import type { DialectId, ErrorEntry, Schema } from "dbml2drizzle";
```

| Function | Returns |
|---|---|
| `generateSchema(dbmlText, { dialect = "pg", sourceName = "schema.dbml" })` | The schema source as a string. The same input always gives the same output. |
| `writeSchema(dbmlPath, { dialect = "pg", outPath })` | The written path. Nothing is written when the DBML has errors. |
| `generateDbPatch(dbmlText)` | The dbdocs-ready DBML as a string. |
| `writeDbPatch(dbmlPath, { outPath })` | The written path. |
| `parseSchema(dbmlText)` | The parsed, dialect-neutral schema description (`{ tables, enums, relationships, patchEdits }`). |
| `dialects` | The supported targets: `["pg", "sqlite"]`. |
| `DbmlError` | Thrown for DBML problems. `error.errors` is `[{ line, table, column, message }]`. |

An unsupported dialect throws `Error("Unsupported dialect '<id>'. Supported: pg, sqlite")`.

## DBML reference

This section lists everything the generator understands. Anything else is reported as an error, so no part of your schema is ever skipped silently.

### Tables

```dbml
Table accounts {
  id integer [pk, increment]
}

Table "order items" as OI [headercolor: #3498DB, note: 'Line items'] {
  id integer [pk]
}
```

- Table and column names may be quoted (`"order items"`); the quotes are removed.
- An alias (`as OI`) is accepted and ignored.
- Table settings:
  - `note: '...'` becomes the table's [note](#notes);
  - `headercolor` is accepted and ignored.

  Any other table setting is an error.
- Every table needs at least one column. Duplicate table or column names are errors.

### Column types (PostgreSQL)

Type names are case-insensitive. Each type maps to a `drizzle-orm/pg-core` column builder, and the database column name is always passed explicitly.

| DBML | Generated | Notes |
|---|---|---|
| `varchar(n)`, `string(n)` | `varchar("c", { length: n })` | |
| `varchar`, `string` | `varchar("c")` | No length: an unbounded `varchar`. |
| `char(n)` | `char("c", { length: n })` | |
| `text`, `text('tiny' \| 'medium' \| 'long')` | `text("c")` | PostgreSQL has one text type. Any other argument is an error. |
| `integer`, `int` | `integer("c")` | |
| `smallint` | `smallint("c")` | |
| `bigint` | `bigint("c", { mode: "number" })` | |
| `decimal(p, s)`, `numeric(p, s)` | `numeric("c", { precision: p, scale: s })` | |
| `float`, `double` | `doublePrecision("c")` | |
| `real` | `real("c")` | |
| `boolean`, `bool` | `boolean("c")` | |
| `timestamp`, `datetime` | `timestamp("c")` | Without time zone. |
| `timestamptz` | `timestamp("c", { withTimezone: true })` | |
| `date`, `dateonly` | `date("c")` | |
| `time` | `time("c")` | |
| `json` / `jsonb` | `json("c")` / `jsonb("c")` | |
| `uuid` | `uuid("c")` | |
| `enum('a', 'b', …)` | a `pgEnum` | See [Enums](#enums). |

Any other type (for example `money`, `integer[]` or `double precision`) is an error: `Unsupported data type '<type>'`.

### Column settings

```dbml
email varchar(100) [unique, not null, note: 'login, never shared']
```

| Setting | Generated |
|---|---|
| `pk` or `primary key` | `.primaryKey()` |
| `increment` | `.generatedByDefaultAsIdentity()`. Only on `integer`, `bigint` or `smallint`; any other type is an error. |
| `not null` | `.notNull()` |
| `null`, or neither | nothing; the column is nullable |
| `unique` | `.unique()` |
| `default: …` | see [Default values](#default-values) |
| `note: '…'` | a JSDoc comment; see [Notes](#notes) |
| `ref: > table.column` (also `<`, `-`) | `.references(…)`; see [Relationships](#relationships-foreign-keys) |
| `delete: <action>` / `update: <action>` | `onDelete` / `onUpdate` of the column's `ref` |
| ``check: `<expression>` `` | a check constraint named `<table>_<column>_check`; see [Check constraints](#check-constraints) |

Commas, colons, brackets, braces and `//` inside quoted values are plain text. Use `\'` for a quote inside a quoted value. Any other setting is an error: `Unknown column setting '<setting>'`.

### Default values

| DBML | Generated |
|---|---|
| `default: 'active'` | `.default("active")` |
| `default: 42`, `default: -1.5` | `.default(42)`, `.default(-1.5)` |
| `default: true`, or `1` / `0` on a `boolean` | `.default(true)` / `.default(false)` |
| `default: null` | `.default(null)` |
| `` default: `now()` `` | `.defaultNow()` |
| `` default: `CURRENT_TIMESTAMP` `` or any other backtick expression | ``.default(sql`CURRENT_TIMESTAMP`)``, which imports `sql` from `drizzle-orm` |

### Enums

```dbml
Table accounts {
  status enum('active', 'closed') [default: 'active']
}
```

**Inline enums.** Each `enum(...)` column gets its own PostgreSQL enum type, named `enum_<table>_<column>`. It is declared once, before the tables:

```ts
export const enum_accounts_status = pgEnum("enum_accounts_status", ["active", "closed"]);

export const accounts = pgTable("accounts", {
  status: enum_accounts_status("status").default("active"),
});
```

**Shared enums.** An `Enum` block declares one enum type that any number of columns use by its name:

```dbml
Table orders {
  status order_status [not null, default: 'new']
}

Table order_events {
  status order_status
}

Enum order_status {
  Note: 'Lifecycle of an order'
  new
  "in progress" [note: 'being packed']
  shipped
}
```

```ts
/**
 * Lifecycle of an order
 * in progress: being packed
 */
export const order_status = pgEnum("order_status", ["new", "in progress", "shipped"]);
```

- The database type has exactly the block's name; the block can come before or after the tables that use it.
- A column uses the enum when its type is the enum's name (case-sensitive, no arguments).
- Values are bare words or `"double-quoted"`, each optionally `[note: '…']`; the block may have a `Note`. The notes become the JSDoc comment above the enum.
- A column default must be one of the enum's values.
- Every `Enum` block is declared, even if no column uses it. Shared enums come first, in file order, then inline enums.
- Not supported: schema-qualified names (`Enum sales.status`), and an enum named like a built-in type, a table or an inline enum's `enum_<table>_<column>`.

### Notes

Drizzle cannot declare table or column comments, so drizzle-kit never writes `COMMENT ON`. Notes are therefore kept as **JSDoc comments** in the generated schema, directly above their table or column. They are not stored in the database.

```dbml
Table orders {
  id integer [pk, note: 'order number']
  Note: 'Orders placed by accounts'
}
```

```ts
/** Orders placed by accounts */
export const orders = pgTable("orders", {
  /** order number */
  id: integer("id").primaryKey(),
});
```

`Note: '…'`, `Note: { … }`, `Note { … }` and the `note:` table setting all work, as do triple-quoted multi-line notes. Notes are plain text and are never turned into constraints.

### Relationships (foreign keys)

The foreign key always ends up on the "many" side. You can declare it on either side, inline or as a standalone `Ref:`.

| DBML | Foreign key on | Kind |
|---|---|---|
| `orders.account_id [ref: > accounts.id]` | `orders.account_id` | many-to-one |
| `accounts.id [ref: < orders.account_id]` | `orders.account_id` | same relationship, other side |
| `profiles.user_id [ref: - users.id]` | `profiles.user_id`, which also becomes unique | one-to-one |

```dbml
account_id integer [ref: > accounts.id, delete: cascade, update: no action, not null]

Ref: orders.approved_by > accounts.id [delete: set null]
Ref {
  orders.updated_by > accounts.id [update: cascade]
}
```

```ts
account_id: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade", onUpdate: "no action" }),
```

- Actions: `cascade`, `set null`, `set default`, `restrict`, `no action`.
- References are lazy (`() => table.column`), so self-references and cycles between tables need no special ordering.

**Self-references and cycles.** TypeScript cannot infer the type of a table whose references lead back to it, either directly (`accounts.created_by → accounts.id`) or through other tables (`departments.manager_id → employees`, `employees.department_id → departments`). Those references get an explicit callback type, `AnyPgColumn` (PostgreSQL) or `AnySQLiteColumn` (SQLite), imported as a type only when the file needs it:

```ts
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export const accounts = pgTable("accounts", {
  id: integer("id").primaryKey(),
  created_by: integer("created_by").references((): AnyPgColumn => accounts.id, { onDelete: "set null" }),
});
```

Every other reference is written as `() => table.column`. The type changes nothing in the database: drizzle-kit generates the same SQL.

**Composite references** are written as standalone references, and become `foreignKey()` in the table's extra config:

```dbml
Ref: orders.(shop_id, code) > products.(shop_id, code) [delete: cascade]
```

```ts
}, (t) => [
  foreignKey({ columns: [t.shop_id, t.code], foreignColumns: [products.shop_id, products.code] }).onDelete("cascade"),
]);
```

**Declaring a relationship twice** (e.g. inline and as a `Ref:`) is fine when both declarations agree. If they differ, it is an error naming both lines.

**Not supported:**
- many-to-many `<>` (use a junction table);
- inline composite references;
- references to unknown tables or columns.

### Indexes and primary keys

```dbml
Table orders {
  id integer [pk]
  account_id integer
  placed_at timestamp
  details jsonb

  indexes {
    account_id
    (account_id, placed_at) [unique, name: 'orders_by_account']
    details [type: gin]
  }
}
```

```ts
}, (t) => [
  index("orders_account_id").on(t.account_id),
  uniqueIndex("orders_by_account").on(t.account_id, t.placed_at),
  index("orders_details").using("gin", t.details),
]);
```

- **Index name**: the declared `name:`, otherwise `<table>_<column>_<column>…`.
- **Composite primary key**: an index entry marked `pk`, such as `(order_id, line_no) [pk]`. It becomes `primaryKey({ columns: [t.order_id, t.line_no] })` rather than an index. Declaring a primary key both on a column and in `indexes` is an error.
- **Expression indexes**: write an expression in backticks, alone or among columns, in the order you want: `` `lower(email)` [unique, name: 'users_email_ci'] `` or `` (`lower(email)`, created_at) [name: 'users_email_created'] ``. It becomes ``.on(sql`lower(email)`, t.created_at)``. An entry with an expression needs a `name:`. The expression is copied as written; PostgreSQL needs parentheses around anything that is not a function call, so write `` `(prefs -> 'tags')` ``, not `` `prefs -> 'tags'` ``.
- **Partial indexes**: ``where: `<condition>` `` limits the index to matching rows: ``email [unique, where: `deleted_at is null`]`` becomes ``uniqueIndex("users_email").on(t.email).where(sql`deleted_at is null`)``. It works with `unique`, `name`, `type` and expressions, but not with `pk`.
- In expressions and conditions, write `` \` `` for a backtick. Nothing in them is validated; the database reports invalid SQL.
- **Not supported**: `concurrently`, sort order (`desc`, `nulls first`), operator classes and `with (...)` storage parameters. Write them by hand in a custom migration (`drizzle-kit generate --custom`).

### Check constraints

```dbml
Table events {
  id integer [pk]
  starts_at timestamptz [not null]
  ends_at timestamptz [not null]
  seats integer [check: `seats > 0`]

  checks {
    `ends_at > starts_at` [name: 'events_valid_range']
  }
}
```

```ts
}, (t) => [
  check("events_seats_check", sql`seats > 0`),
  check("events_valid_range", sql`ends_at > starts_at`),
]);
```

- **On a column**: ``check: `<expression>` ``, at most one per column. It is named `<table>_<column>_check`.
- **On a table**: one `checks { }` block, one `` `<expression>` [name: '<name>'] `` per line. `name` is required and is the only setting, so names stay the same when checks are added or reordered.
- Drizzle declares every check on the table, so column checks are emitted there too: column checks first, in column order, then table checks in block order.
- The expression is copied exactly as written and is not validated; the database reports invalid SQL. Write `` \` `` for a backtick inside it.
- Check names must be unique across the schema.
- Standard DBML accepts both forms, so `dbml2drizzle patch` copies them unchanged.

### Project, TableGroup and comments

`Project` and `TableGroup` blocks are allowed and ignored. `//` comments are ignored anywhere outside quoted text.

## The generated schema

Sections always come in this order, so the same DBML gives a byte-identical file:

1. A header: `// Generated by dbml2drizzle from db.dbml. Do not edit by hand.`
2. Imports, with names sorted: `drizzle-orm` (`relations`, `sql`) and the target's module (`drizzle-orm/pg-core` or `drizzle-orm/sqlite-core`). Only what is used is imported.
3. Enums, in table and column file order.
4. Tables, in DBML file order. Each table's extra config lists the composite primary key, then the composite foreign keys, then the indexes.
5. Relations (see [Relations](#relations)).

**Identifiers:**
- **Column keys**: the database name as is, quoted when it isn't a valid JavaScript identifier (`"first-name": varchar("first-name")`).
- **Table exports**: the table name, with characters that can't appear in an identifier replaced by `_`. A `_` is prefixed when the name starts with a digit or is a reserved word, so the table `class` is exported as `_class` but stays `pgTable("class", …)`. Two tables that end up with the same export name are an error.

The PostgreSQL output is also valid JavaScript (ESM), unless it contains self-references or reference cycles, whose callbacks are typed (see [Relationships](#relationships-foreign-keys)). A SQLite schema with enums (`as const`, see [SQLite](#sqlite)) or with such references is TypeScript only.

Don't edit the generated file. Change the DBML and regenerate.

## Relations

Every relationship generates Drizzle [`relations()`](https://orm.drizzle.team/docs/relations) on both tables, for the relational query API:

```ts
export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.author_id], references: [users.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}));
```

**Naming rules:**

| Side | Name |
|---|---|
| Foreign-key side | The column without a trailing `_id` / `Id` (`author_id` → `author`). If the column has no such suffix, or the name is already a column, it is `<column>_<target table>` (`approved_by` → `approved_by_users`). A composite key uses the target table name. |
| Referenced side | The source table name (`posts`); `one()` for a one-to-one, `many()` otherwise. |
| Self-references, or several relationships between the same two tables | Both sides get `relationName: "<table>_<columns>"`, and the referenced side is named `<table>_by_<columns>` (`users_by_manager_id`). |

- A name that is still taken by a column or another relation is an error naming the table. Rename the column in the DBML.
- Tables without relationships get no relations export.

## Renaming a table or column

DBML cannot say "this was renamed", and `renamed_from` is no longer supported; using it is an error. Just rename the table or column in the DBML, regenerate the schema, and run `drizzle-kit generate` **in a terminal**. drizzle-kit asks whether the new name is a rename or a new table or column. Answer "rename" to keep the data.

drizzle-kit 0.31 has no option to skip this prompt, so don't run `generate` after a rename in CI. Always review the SQL: answering "create" drops the old column and its data.

## Moving from dbml2sequelize

To switch an existing database that was created by dbml2sequelize migrations:

1. Generate the schema, then run `drizzle-kit generate` to get the initial migration.
2. Run `drizzle-kit pull` against the existing database and compare its output with the generated schema. Fix the DBML until they match. Expect these differences, because types are now converted [as written](#converted-as-written):
   - **`varchar` without a length**: Sequelize created `varchar(255)`. Write `varchar(255)` in the DBML to keep it.
   - **`timestamp` / `datetime`**: Sequelize created `timestamp with time zone`. Write `timestamptz` to keep it.
   - **`increment`**: Sequelize created `serial` columns, and the generator now uses identity columns. Either accept the conversion in the next migration (review it), or keep the database as it is.
   - **Notes**: the comments Sequelize stored stay in the database, but new Drizzle migrations don't add or change comments.
3. Mark the initial migration as applied in drizzle-kit's migrations table instead of running it.

Other removed features:
- the `migrate`, `diff` and `baseline` commands: use `drizzle-kit generate`;
- the snapshot file and `--allow-data-loss`: drizzle-kit keeps its own snapshots, and you review the SQL;
- the models API.

## Target databases

| Target | `--dialect` | Drizzle module | drizzle-kit |
|---|---|---|---|
| PostgreSQL (default) | `pg` | `drizzle-orm/pg-core` | `dialect: "postgresql"` |
| SQLite (Cloudflare D1, libSQL/Turso, local SQLite) | `sqlite` | `drizzle-orm/sqlite-core` | `dialect: "sqlite"` (D1: `driver: "d1-http"`; Turso: `dialect: "turso"`) |

Drizzle uses a separate schema per database, so each target is a self-contained module:

```text
src/dialects/
  index.js        registry: { pg, sqlite }
  pg/
    types.js      DBML type → pg-core builder
    defaults.js   default values
    enums.js      enum declarations
    index.js      the dialect object
  sqlite/
    types.js      DBML type → sqlite-core builder
    defaults.js   default values
    enums.js      enum values, enum columns and enum checks
    increment.js  the increment rule
    index.js      the dialect object
```

Rules shared by every target (enum collection, naming, ordering, relations) live in `src/generator/`. Adding a target such as MySQL means:
1. add a folder with the same parts;
2. register it in `src/dialects/index.js`;
3. add tests for its full type mapping.

The parser and the shared schema description don't change.

## SQLite

Drizzle uses one SQLite schema (`drizzle-orm/sqlite-core`) for every SQLite database it supports, so one target serves them all: **Cloudflare D1**, **libSQL / Turso**, **better-sqlite3**, **`node:sqlite`**, **Bun** and **Expo**. Select it with `--dialect sqlite` on the command line or `{ dialect: "sqlite" }` in the JavaScript API:

```bash
npx dbml2drizzle schema db/db.dbml --out src/db/schema.ts --dialect sqlite
```

The generated schema is the same for every SQLite database; only `drizzle.config.ts` (and the `drizzle()` import at runtime) differ:

| Database | `drizzle.config.ts` |
|---|---|
| Cloudflare D1 | `dialect: "sqlite"`, `driver: "d1-http"` |
| libSQL / Turso | `dialect: "turso"` |
| Local file (better-sqlite3, `node:sqlite`, Bun, Expo) | `dialect: "sqlite"` |

```ts
// drizzle.config.ts (Cloudflare D1)
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "d1-http",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
```

The package's tests check the generated schema with drizzle-kit's SQLite generator and against Cloudflare D1's rules; the other drivers use the same schema.

The same `db.dbml` works for both targets. Everything in the [DBML reference](#dbml-reference) applies, except as listed below. Relations, naming, ordering and notes (JSDoc comments) are the same as for PostgreSQL.

### Column types (SQLite)

SQLite stores every value as integer, real, text or blob, so several DBML types share one storage type.

| DBML | Generated | Notes |
|---|---|---|
| `varchar(n)`, `string(n)`, `char(n)` | `text("c", { length: n })` | The length is kept as written but SQLite does not enforce it. |
| `varchar`, `string`, `char`, `text`, `text('tiny' \| 'medium' \| 'long')` | `text("c")` | |
| `integer`, `int`, `smallint` | `integer("c")` | |
| `bigint` | `integer("c", { mode: "number" })` | 64-bit; values beyond JavaScript's safe range follow Drizzle's number mode, as for PostgreSQL. |
| `float`, `double`, `real` | `real("c")` | |
| `decimal(p, s)`, `numeric(p, s)` | `text("c")` | Stored as text, so values stay exact; Drizzle returns strings, as for PostgreSQL `numeric`. Precision and scale are not enforced, and SQL comparison and sorting work on the text. |
| `boolean`, `bool` | `integer("c", { mode: "boolean" })` | |
| `timestamp`, `datetime`, `timestamptz`, `date`, `dateonly`, `time` | `text("c")` | ISO-8601 text, returned as strings. `timestamptz` and `timestamp` are stored the same way: store UTC or include the offset yourself. |
| `json`, `jsonb` | `text("c", { mode: "json" })` | Drizzle parses the JSON; `json` and `jsonb` behave the same. |
| `uuid` | `text("c")` | |
| `enum('a', 'b', …)` and `Enum` blocks | `text("c", { enum: <values> })` + a check | See below. |

### Enums (SQLite)

SQLite has no enum type. Each enum (inline or `Enum` block) is declared **once** as a constant of its values, named as for PostgreSQL. Every column that uses it is text limited to those values in TypeScript, and a generated check constraint enforces them in the database:

```ts
export const enum_accounts_status = ["active", "closed"] as const;

export const accounts = sqliteTable("accounts", {
  status: text("status", { enum: enum_accounts_status }).default("active"),
}, (t) => [
  check("accounts_status_enum", sql`status IN ('active', 'closed')`),
]);
```

- The check is named `<table>_<column>_enum` and comes after the table's declared checks, in column order.
- Values are quoted with `'` doubled; a column name that isn't a plain identifier is double-quoted.
- Adding or removing a value later changes the check, which drizzle-kit applies by rebuilding the table.

### Keys, defaults and indexes (SQLite)

- **`increment`** is allowed only on the table's single primary key of type `integer`, `smallint` or `bigint`, and becomes `.primaryKey({ autoIncrement: true })` (`INTEGER PRIMARY KEY AUTOINCREMENT`). Anywhere else it is an error.
- **Defaults**: `` `now()` `` and `CURRENT_TIMESTAMP` become ``.default(sql`(CURRENT_TIMESTAMP)`)``; `CURRENT_DATE` and `CURRENT_TIME` become ``sql`(CURRENT_DATE)` `` and ``sql`(CURRENT_TIME)` ``. Other backtick expressions are written as is: SQLite requires parentheses around an expression default, so write `` default: `(abs(-1))` ``. Values are written as for PostgreSQL.
- **Indexes**: plain, unique, composite, expression and partial indexes work as for PostgreSQL. An index `type:` (e.g. `gin`) is an error, because SQLite has no index types.
- **References** with `delete:` / `update:` actions and composite foreign keys work as for PostgreSQL. D1 enforces foreign keys; for local SQLite files, foreign keys are enforced when the driver enables `PRAGMA foreign_keys`.

### Errors (SQLite)

| Message | Cause |
|---|---|
| `increment on SQLite needs the table's single integer primary key` | `increment` on a column that is not the table's only primary key, or not `integer`, `smallint` or `bigint`. |
| `Index type '<TYPE>' is not supported on SQLite` | An index with `type:`. Reported at the table's line. |
| `Check name '<name>' is declared and also generated for enum column <table>.<column>` | A declared check named like a generated enum check. |
| `Type '<type>' has no SQLite mapping` | A known DBML type SQLite can't express. |

## Errors

The whole file is checked before anything is written. Every problem is reported in one run, in line order, as `line <n>: <table>.<column>: <message>`.

| Message | Cause |
|---|---|
| `Unsupported data type '<type>'` | A type not in the [type table](#column-types-postgresql). |
| `Type '<type>' has no PostgreSQL mapping` | A known DBML type the target can't express. For SQLite-only errors, see [Errors (SQLite)](#errors-sqlite). |
| `increment needs integer, bigint or smallint` | `increment` on another type. |
| `enum must have at least one value` | `enum()` |
| `text accepts only tiny, medium or long` | `text('huge')` |
| `renamed_from is no longer supported: confirm renames in drizzle-kit generate's prompt` | `renamed_from` on a table or column. |
| `Column is missing its type` | A column line with only a name. |
| `Unknown column setting '<setting>'` / `Unknown table setting '<setting>'` | A setting that isn't listed above. |
| `delete/update actions need a ref on the same column` | `delete:` / `update:` without `ref:`. |
| `References unknown table '<table>'` / `References unknown column '<table>.<column>'` | A `ref` to something that isn't in the DBML. |
| `Malformed reference '<text>'` | A `ref` or `Ref:` line that can't be read. |
| `Many-to-many references (<>) are not supported` | `ref: <> …` |
| `Composite references must be written as standalone Ref: lines` | `ref: > t.(a, b)` inline. |
| `Composite reference sides have different column counts` | `Ref: a.(x) > b.(x, y)` |
| `Conflicting declarations of A → B (lines n and m)` | The same relationship declared twice, differently. |
| `Unknown reference setting '<setting>'` | A `Ref:` setting other than `delete`, `update`, `color`. |
| `Index refers to unknown column '<column>'` / `Unknown index setting '<setting>'` | Index problems. |
| `Expression indexes need a name, e.g. [name: '…']` / `Index expression is empty` | An expression index without `name`, or `` `` `` as an index part. |
| ``where must be a backtick expression, e.g. where: `deleted_at is null` `` / `Index condition is empty` / `An index takes one where condition` | A malformed or repeated `where:`. |
| `A primary key cannot have an expression or a where condition` | `pk` together with an expression or `where:` in `indexes`. |
| ``check must be a backtick expression, e.g. check: `price >= 0` `` / `Check must be a backtick expression` | A quoted string instead of a backtick expression. |
| `Check expression is empty` | ``check: `` `` or an empty `checks` entry. |
| `A column takes one check; use a table checks { } block for more` | Two `check:` settings on one column. |
| `Table checks need a name, e.g. [name: '…']` / `Unknown check setting '<setting>'` | A `checks` entry without `name`, or with another setting. |
| `Table '<table>' has more than one checks block` | Two `checks { }` blocks in one table. |
| `Duplicate check name '<name>' (also on line <n>)` | Two checks with the same name. |
| `Table '<table>' declares its primary key twice` | Column-level and index-level `pk` in one table. |
| `Relation '<name>' collides with a column or relation of '<table>'` | See [Relations](#relations). |
| `Table name '<a>' and '<b>' both become '<id>' in generated code` | See [identifiers](#the-generated-schema). |
| `Duplicate enum '<name>' (also on line <n>)` / `Enum '<name>' has no values` / `Duplicate value '<value>' in enum '<name>'` / `Unknown enum value setting '<setting>'` | Problems inside `Enum` blocks. |
| `Enum '<name>' has the name of a built-in type` / `Schema-qualified enum names are not supported: '<name>'` | An enum name that cannot be used. |
| `Enum '<name>' has the same name as table '<name>' (line <n>)` / `Enum '<name>' has the same name as the enum type of <table>.<column> (line <n>)` | An enum name already taken in the database. |
| `Default '<value>' is not a value of enum '<name>' (…)` | A default outside the column's enum. |
| `Enum name '<a>' and '<b>' both become '<id>' in generated code` | Two enum names that become the same identifier. |
| `Duplicate table` / `Duplicate column` / `Table has no columns` | As described. |
| `Unknown block '<word>'` / `'<block>' must be inside a Table` / `'<block>' is not allowed inside a Table` | A block in the wrong place. |
| `Block '<header>' is missing its closing '}'` / `Unexpected '}'` / `Unexpected line '<text>'` | Unbalanced braces or stray text. |

## Converted as written

The package checks the **DBML**: syntax, types, references, conflicting declarations, and that each directive maps to a Drizzle construct for the target. It does **not** check database-specific rules or limits, such as identifier length or a `delete: set null` on a `not null` column. Those are left to drizzle-kit and your database. Nothing is renamed, shortened or "fixed". If the database rejects something, fix it in the DBML and regenerate.

## Documentation with dbdocs

Standard DBML tools (dbdocs, dbdiagram, `@dbml/core`) reject four parts of this project's dialect: `delete:` / `update:` inside a column's settings, `Note: {` blocks, `where:` on an index, and a `Note` inside an `Enum`. The `patch` command writes a copy they accept:

```bash
npx dbml2drizzle patch db/db.dbml          # → db/db-patch.dbml
npx dbdocs build ./db/db-patch.dbml
```

| `db.dbml` | `db-patch.dbml` |
|---|---|
| `account_id integer [ref: > accounts.id, delete: cascade, not null] // owner` | `account_id integer [not null] // owner`, plus `Ref: orders.account_id > accounts.id [delete: cascade]` at the end of the file |
| `Note: {` | `Note {` |
| `Enum s { Note: 'Lifecycle'` … `new` … `}` | the `Note` is removed and moved onto the first value: `new [note: 'Lifecycle']`; if that value has a note, `'Lifecycle (its note)'` |
| ``email [unique, where: `deleted_at is null`, note: 'active users']`` | `email [unique, note: 'active users (where deleted_at is null)']`; without a note, `note: 'where …'` is added |
| everything else | copied unchanged |

- Moved references are appended under the comment `// Relationships moved from inline settings by dbml2drizzle`.
- `db.dbml` is never modified.
- Regenerate the copy whenever `db.dbml` changes.

## Contributing to this package

```bash
pnpm install
pnpm test               # type check (tsc), then node:test; generated schemas are checked through drizzle-kit, no database needed
pnpm run build:types    # write the type declarations to types/
```

Every parser fix and every change to generated output comes with a test that asserts the generated content, using inline DBML strings.

**Types.** The source is CommonJS JavaScript with JSDoc types; files marked `// @ts-check` (the public API, the dialect objects and the parser's entry) are type-checked strictly by `pnpm test`. The declarations in `types/` are generated from that JSDoc (also on `npm pack` / `npm publish`, through `prepack`); they are not committed and must not be edited by hand. Shared types live in `src/types.js`. TypeScript is a development dependency only.

**ES module entry.** `src/index.mjs` only re-exports `src/index.js`, and `package.json` routes `import` to it through `exports`. Keep `module.exports = { … }` in `src/index.js` a literal of shorthand names, so Node.js can read the names. `tests/consumers.test.js` installs the packed package into throw-away CommonJS, ES module and TypeScript projects to check this.

| Path | Purpose |
|---|---|
| `src/index.js`, `src/index.mjs` | The public API, for CommonJS and ES modules. |
| `src/types.js` | Shared JSDoc types (schema description, errors, dialect contract). |
| `src/parse-schema.js` | The single DBML parser. It produces the schema description that every output reads. |
| `src/parser/`, `src/utils/` | Line and block parsing. |
| `src/converter/` | Types (canonical DBML names), defaults, notes, indexes, relationships. |
| `src/dialects/` | One module per target database. |
| `src/generator/` | Schema generator, relations, identifiers, file writer. |
| `src/patch/` | `db-patch.dbml` generator and writer. |
| `bin/dbml2drizzle.js` | Command line. |
| `tests/` | `node:test` tests. (`test/` is reserved for private schemas and is gitignored.) |

## License

MIT — see [LICENSE](LICENSE).
