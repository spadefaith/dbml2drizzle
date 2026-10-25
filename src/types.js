// @ts-check
/**
 * Shared JSDoc types: the schema description (the result of parseSchema),
 * error entries, and the dialect contract. Types only; no runtime code. The
 * published declarations (types/) are generated from these.
 */

/**
 * @typedef {object} Schema
 * @property {Table[]} tables
 * @property {Enum[]} enums
 * @property {View[]} views
 * @property {Relationship[]} relationships
 * @property {PatchEdit[]} patchEdits
 */

/**
 * A `View` block (see specs/012-dbml-views/data-model.md). Its columns are
 * Columns with only `comment` and `allowNull: false` among the settings.
 *
 * @typedef {object} View
 * @property {string} name
 * @property {boolean} materialized
 * @property {Column[]} columns
 * @property {string} query
 * @property {string} comment
 * @property {number} line
 */

/**
 * @typedef {object} Table
 * @property {string} name
 * @property {string} comment
 * @property {Column[]} columns
 * @property {Index[]} indexes
 * @property {Check[]} checks
 * @property {number} line
 */

/**
 * @typedef {object} Column
 * @property {string} name
 * @property {ColumnType} type
 * @property {number} line
 * @property {string} [comment]
 * @property {boolean} [primaryKey]
 * @property {boolean} [autoIncrement]
 * @property {boolean} [allowNull]
 * @property {boolean} [unique]
 * @property {DefaultValue} [defaultValue]
 */

/**
 * A canonical DBML type: aliases are folded (int → integer, string →
 * varchar, …). A column using an `Enum` block has `name: "enum"`, the
 * block's values as `args` and the block's name as `ref`.
 *
 * @typedef {object} ColumnType
 * @property {"varchar" | "char" | "text" | "integer" | "bigint" | "smallint" | "decimal" | "float" | "double" | "real" | "boolean" | "timestamp" | "timestamptz" | "date" | "time" | "json" | "jsonb" | "uuid" | "enum"} name
 * @property {(string | number)[]} args
 * @property {string} [ref]
 */

/**
 * @typedef {{ kind: "fn", value: "now" } | { kind: "literal", value: string } | { kind: "value", value: string | number | boolean | null }} DefaultValue
 */

/**
 * @typedef {object} Index
 * @property {string[]} fields
 * @property {({ column: string } | { expression: string })[]} parts
 * @property {string} name
 * @property {boolean} [unique]
 * @property {string} [using]
 * @property {string} [where]
 */

/**
 * @typedef {object} Check
 * @property {string} name
 * @property {string} expression
 * @property {string} [column]
 * @property {number} line
 */

/**
 * @typedef {object} Enum
 * @property {string} name
 * @property {{ value: string, note?: string }[]} values
 * @property {string} [note]
 * @property {number} line
 */

/**
 * @typedef {object} Relationship
 * @property {{ table: string, columns: string[] }} from
 * @property {{ table: string, columns: string[] }} to
 * @property {"many-to-one" | "one-to-one"} kind
 * @property {boolean} composite
 * @property {string} [onDelete]
 * @property {string} [onUpdate]
 * @property {{ line: number, form: "inline" | "standalone" }[]} declaredAt
 */

/**
 * An edit that db-patch.dbml applies to one line of the DBML.
 *
 * @typedef {object} PatchEdit
 * @property {number} line
 * @property {string} [replacement]
 * @property {string[]} [replacementLines] lines that replace `line`, written with the file's line ending (view edits only)
 * @property {string} [appendRef]
 * @property {boolean} [remove]
 */

/**
 * One problem found in the DBML (an entry of DbmlError.errors).
 *
 * @typedef {object} ErrorEntry
 * @property {string} message
 * @property {number} [line]
 * @property {string} [table]
 * @property {string} [column]
 */

/**
 * Where a problem is: the table, column and line known so far.
 *
 * @typedef {{ table?: string, column?: string, line?: number }} Location
 */

/**
 * Collects every problem of one run (see errors.js).
 *
 * @typedef {object} Collector
 * @property {(error: ErrorEntry) => void} add
 * @property {() => boolean} hasErrors
 * @property {(footer?: string) => void} throwIfAny
 */

/**
 * An enum as collected for code generation (see generator/collect-enums.js).
 *
 * @typedef {object} CollectedEnum
 * @property {string} exportName
 * @property {string} dbName
 * @property {string[]} values
 * @property {string} [ref]
 * @property {string} [table]
 * @property {string} [column]
 * @property {string[]} [notes]
 * @property {number} [line]
 */

/**
 * A column builder call: the builders it imports and its source text.
 *
 * @typedef {{ builders: string[], text: string }} ColumnCall
 */

/**
 * A target dialect (see dialects/<target>/index.js and
 * specs/008-cloudflare-d1-dialect/data-model.md). Optional parts default to
 * the PostgreSQL behaviour in the generator.
 *
 * @typedef {object} Dialect
 * @property {string} id
 * @property {string} [label]
 * @property {string} module
 * @property {string} tableBuilder
 * @property {string | null} enumBuilder
 * @property {string} checkBuilder
 * @property {string} viewBuilder builder of a plain view (e.g. pgView)
 * @property {string | null} materializedViewBuilder builder of a materialized view; null: the target has none
 * @property {string} [anyColumnType] column type of typed reference callbacks in cycles (e.g. AnyPgColumn); absent: references stay untyped
 * @property {(column: Column, location: Location, collector: Collector, table: Table) => ColumnCall | null} columnCall
 * @property {(defaultValue: DefaultValue) => { text: string, usesSql: boolean }} defaultModifier
 * @property {(schema: Schema, collector?: Collector) => CollectedEnum[]} collectEnums
 * @property {(e: CollectedEnum) => string} enumDeclaration
 * @property {(enumDef: CollectedEnum, column: Column, location: Location, collector: Collector, table: Table) => ColumnCall | null} [enumColumnCall]
 * @property {(column: Column) => string} [primaryKeyModifier]
 * @property {boolean} [indexTypes]
 * @property {(table: Table, enums: CollectedEnum[]) => { name: string, expression: string, column: string }[]} [tableChecks]
 */

// Parser internals (used by parse-schema.js; not part of the public API)

/**
 * One line of DBML inside a block (see utils/grouping.js).
 *
 * @typedef {{ text: string, raw: string, line: number, commentIndex: number }} Item
 */

/**
 * A `{ … }` block of DBML with its lines and nested blocks.
 *
 * @typedef {object} Block
 * @property {string} header
 * @property {number} line
 * @property {string} raw
 * @property {Item[]} items
 * @property {Block[]} blocks
 * @property {number} [endLine]
 * @property {number} [commentIndex]
 */

/**
 * A block header: its type (`Table`, `Enum`, `indexes`, …), name and raw
 * `[…]` settings text (see parser/parse-definition-type.js).
 *
 * @typedef {{ type: string, name: string, settings: string }} Definition
 */

/**
 * One setting of a `[…]` list (see utils/parse-settings.js); `value` is
 * `true` for a flag such as `pk`.
 *
 * @typedef {{ key: string, value: string | boolean, text: string }} Setting
 */

/**
 * A column line of a table (see parser/parse-table-content.js).
 *
 * @typedef {object} ColumnLine
 * @property {"column"} kind
 * @property {string} name
 * @property {string} typeRaw
 * @property {Setting[]} settings
 * @property {number} line
 * @property {string} raw
 * @property {string} indent
 * @property {string} head
 * @property {string} trailing
 */

/**
 * A `Note: '…'` line of a table.
 *
 * @typedef {{ kind: "note", value: string, line: number }} NoteLine
 */

/**
 * One line of an `indexes { }` block (see parser/parse-indexes-content.js).
 *
 * @typedef {object} IndexLine
 * @property {({ column: string } | { expression: string })[]} parts
 * @property {string[]} fields
 * @property {Setting[]} settings
 * @property {number} line
 * @property {string} indent
 * @property {string} target
 * @property {string} trailing
 */

/**
 * One line of a `checks { }` block (see parser/parse-checks-content.js).
 *
 * @typedef {{ expression: string, settings: Setting[], line: number, indent: string, target: string, trailing: string }} CheckLine
 */

/**
 * A reference as written, before it is resolved into a Relationship.
 *
 * @typedef {object} RawRef
 * @property {{ table: string, columns: string[] }} from
 * @property {string} op
 * @property {{ table: string, columns: string[] }} to
 * @property {string} [onDelete]
 * @property {string} [onUpdate]
 * @property {number} line
 * @property {string} form "inline" or "standalone"
 */

module.exports = {};
