const { cleanNote } = require("./convert-note");

const INDEX_SETTINGS = ["type", "name", "unique", "pk", "note"];

/**
 * Turns parsed `indexes { }` lines of one table into data-model.md Indexes:
 * { fields, name, unique, using }. Entries marked `pk` are returned
 * separately in `primaryKeys` ([{ fields, line }]) because they declare the
 * table's primary key rather than an index.
 */
module.exports = function convertIndexes(table, columns, indexLines, collector) {
  const indexes = [];
  const primaryKeys = [];

  for (const { fields, expression, settings, line } of indexLines) {
    const location = { table, line };

    if (expression) {
      collector.add({ ...location, message: "Expression indexes are not supported" });
      continue;
    }

    const unknownField = fields.find((field) => !columns.some((column) => column.name == field));

    if (unknownField) {
      collector.add({ ...location, column: unknownField, message: `Index refers to unknown column '${unknownField}'` });
      continue;
    }

    const index = { fields };
    let isPrimaryKey = false;

    for (const setting of settings) {
      const { key, value } = setting;

      if (!INDEX_SETTINGS.includes(key)) {
        collector.add({ ...location, message: `Unknown index setting '${setting.text}'` });
        continue;
      }

      if (key == "pk") isPrimaryKey = true;
      if (key == "unique") index.unique = true;
      if (key == "type") index.using = String(value).toUpperCase();
      if (key == "name") index.name = cleanNote(value);
    }

    if (isPrimaryKey) {
      primaryKeys.push({ fields, line });
      continue;
    }

    index.name = index.name || `${table}_${fields.join("_")}`;
    indexes.push({
      fields: index.fields,
      name: index.name,
      ...(index.unique && { unique: true }),
      ...(index.using && { using: index.using }),
    });
  }

  return { indexes, primaryKeys };
};
