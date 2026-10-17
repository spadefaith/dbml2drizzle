function toDataType({ name, args }, DataTypes) {
  return args.length ? DataTypes[name](...args) : DataTypes[name];
}

function toDefaultValue({ kind, value }, sequelize) {
  if (kind == "fn") return sequelize.fn(value);
  if (kind == "literal") return sequelize.literal(value);
  return value;
}

/**
 * Builds the attributes object for sequelize.define() from one table of the
 * schema description. Single-column relationships become `references` on
 * the column holding the key; composite ones are not part of the frozen
 * models API.
 */
module.exports = function toModelAttributes(table, relationships, sequelize, DataTypes) {
  return table.columns.reduce((accu, column) => {
    // renamedFrom only drives incremental migrations (Principle IV)
    const { name, type, defaultValue, line, renamedFrom, ...rest } = column;

    accu[name] = {
      ...rest,
      type: toDataType(type, DataTypes),
    };

    if (defaultValue) {
      accu[name].defaultValue = toDefaultValue(defaultValue, sequelize);
    }

    const relationship = relationships.find(
      (item) =>
        !item.composite && item.from.table == table.name && item.from.columns[0] == name
    );

    if (relationship) {
      accu[name].references = {
        model: relationship.to.table,
        key: relationship.to.columns[0],
      };
      relationship.onDelete && (accu[name].onDelete = relationship.onDelete);
      relationship.onUpdate && (accu[name].onUpdate = relationship.onUpdate);
    }

    return accu;
  }, {});
};
