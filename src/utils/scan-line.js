/**
 * Splits DBML text into lines and, for each line, finds the code part (a
 * trailing `//` comment removed) and whether it opens or closes a block.
 * Quotes ('...', "...", `...` and '''...''') are tracked across lines, so
 * braces, brackets and `//` inside quoted text are ignored.
 *
 * Returns [{ line, raw, code, commentIndex, opens, closes, continues }] where
 * `line` is 1-based, `code` is trimmed, `commentIndex` is where the comment
 * starts in `raw` (-1 when there is none), and `continues` is true when a
 * '''multi-line string''' is still open at the end of the line.
 */
module.exports = function scanText(text) {
  const rawLines = text.split(/\r?\n/);
  let quote = null;

  return rawLines.map((raw, index) => {
    let commentIndex = -1;
    let opens = 0;
    let closes = 0;

    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];

      if (quote) {
        if (c == "\\") {
          i++;
        } else if (quote == "'''" && raw.startsWith("'''", i)) {
          quote = null;
          i += 2;
        } else if (c == quote) {
          quote = null;
        }
        continue;
      }

      if (raw.startsWith("'''", i)) {
        quote = "'''";
        i += 2;
      } else if (c == "'" || c == '"' || c == "`") {
        quote = c;
      } else if (c == "/" && raw[i + 1] == "/") {
        commentIndex = i;
        break;
      } else if (c == "{") {
        opens++;
      } else if (c == "}") {
        closes++;
      }
    }

    // single-line quotes never continue onto the next line
    quote != "'''" && (quote = null);

    const code = (commentIndex > -1 ? raw.substring(0, commentIndex) : raw).trim();

    return { line: index + 1, raw, code, commentIndex, opens, closes, continues: quote == "'''" };
  });
};
