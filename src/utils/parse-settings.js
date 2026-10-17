/*

    "name" - 'asdasdasd'
    "note" - 'asdasdasd'
    "default" - 'asdasdasd'

    "primary key" - null
    "pk" - null
    "null" - null
    "not null" - null
    "unique" - null
    "increment" - null

    "ref" - > table.column
    "type" - hash | btree | gist | spgist | gin | brin

*/

/**
 * Splits `text` at `separator` characters that are outside quotes and
 * brackets.
 */
function splitOutside(text, separator) {
  const parts = [];
  let quote = null;
  let depth = 0;
  let current = "";

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quote) {
      if (c == "\\") {
        current += c + (text[i + 1] || "");
        i++;
        continue;
      }
      c == quote && (quote = null);
      current += c;
      continue;
    }

    if (c == "'" || c == '"' || c == "`") {
      quote = c;
    } else if (c == "(" || c == "[") {
      depth++;
    } else if (c == ")" || c == "]") {
      depth--;
    } else if (c == separator && depth == 0) {
      parts.push(current);
      current = "";
      continue;
    }

    current += c;
  }
  parts.push(current);

  return parts;
}

/**
 * Index of the first `separator` outside quotes, or -1.
 */
function indexOutside(text, separator) {
  let quote = null;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quote) {
      c == "\\" ? i++ : c == quote && (quote = null);
    } else if (c == "'" || c == '"' || c == "`") {
      quote = c;
    } else if (c == separator) {
      return i;
    }
  }

  return -1;
}

/**
 * Parses the inside of a DBML settings list, e.g.
 * `note: 'a, b', not null, ref: > users.id` (with or without the outer
 * brackets), into ordered settings:
 * [{ key: "note", value: "'a, b'", text: "note: 'a, b'" }, { key: "not null", value: true, ... }]
 * `key` is lower-cased; `text` is the setting exactly as written.
 */
module.exports = function parseSettings(settings) {
  settings = settings.trim();
  settings.startsWith("[") && (settings = settings.substring(1));
  settings.endsWith("]") && (settings = settings.substring(0, settings.length - 1));

  return splitOutside(settings, ",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((text) => {
      const colonIndex = indexOutside(text, ":");

      if (colonIndex > -1) {
        return {
          key: text.substring(0, colonIndex).trim().toLowerCase(),
          value: text.substring(colonIndex + 1).trim(),
          text,
        };
      }

      return { key: text.replace(/\s+/g, " ").toLowerCase(), value: true, text };
    });
};

module.exports.splitOutside = splitOutside;
module.exports.indexOutside = indexOutside;
