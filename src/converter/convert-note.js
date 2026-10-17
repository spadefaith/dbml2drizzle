/**
 * Removes the surrounding quotes of a DBML string ('...', '''...''' or
 * "...") and unescapes \' inside it.
 */
function cleanNote(note) {
  note = String(note || "").trim();

  for (const quote of ["'''", "'", '"']) {
    if (note.length >= quote.length * 2 && note.startsWith(quote) && note.endsWith(quote)) {
      note = note.substring(quote.length, note.length - quote.length);
      return (quote == "'''" ? note.trim() : note).replace(/\\'/g, "'");
    }
  }

  return note;
}

/**
 * Text of a table note block (`Note: { ... }` or `Note { ... }`): its lines
 * joined with newlines, quotes removed.
 */
module.exports = function convertNote(noteBlock) {
  const content = noteBlock.items.map((item) => item.text).join("\n");
  return content ? cleanNote(content) : "";
};

module.exports.cleanNote = cleanNote;
