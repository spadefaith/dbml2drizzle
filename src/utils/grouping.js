const scanText = require("./scan-line");

/**
 * Groups scanned DBML lines into a tree of blocks.
 *
 * A block is { header, line, raw, items, blocks } where `header` is the code
 * before "{" (e.g. "Table users", "indexes", "Note:"), `items` are the lines
 * inside it ({ text, raw, line, commentIndex }) and `blocks` are nested
 * blocks. Lines outside any block (e.g. standalone `Ref:` lines) are returned
 * in `topLevel`.
 */
/**
 * Joins the lines of a '''multi-line string''' into the line that opens it,
 * so the string reaches the parsers as one line.
 */
function joinMultiLineStrings(scanned) {
  const lines = [];

  for (let i = 0; i < scanned.length; i++) {
    const first = scanned[i];

    if (!first.continues) {
      lines.push(first);
      continue;
    }

    const parts = [first.raw];
    let last = first;

    while (last.continues && i + 1 < scanned.length) {
      last = scanned[++i];
      parts.push(last.raw);
    }

    const raw = parts.join("\n");
    lines.push({
      ...last,
      line: first.line,
      raw,
      code: (last.commentIndex > -1 ? raw.substring(0, raw.length - last.raw.length + last.commentIndex) : raw).trim(),
      commentIndex: -1,
      opens: first.opens + last.opens,
      closes: first.closes + last.closes,
    });
  }

  return lines;
}

module.exports = function grouping(text, collector) {
  const lines = joinMultiLineStrings(scanText(text));
  const root = { header: null, items: [], blocks: [] };
  const stack = [root];
  const current = () => stack[stack.length - 1];
  const item = (scanned, text) => ({
    text,
    raw: scanned.raw,
    line: scanned.line,
    commentIndex: scanned.commentIndex,
  });

  for (const scanned of lines) {
    const { code, line, raw } = scanned;

    if (!code) {
      continue;
    }

    const oneLiner = code.match(/^([^{]*)\{(.*)\}$/s);

    if (code.endsWith("{")) {
      const block = {
        header: code.substring(0, code.length - 1).trim(),
        line,
        raw,
        items: [],
        blocks: [],
      };
      current().blocks.push(block);
      stack.push(block);
    } else if (oneLiner && scanned.opens == 1 && scanned.closes == 1) {
      const inner = oneLiner[2].trim();
      current().blocks.push({
        header: oneLiner[1].trim(),
        line,
        raw,
        items: inner ? [item(scanned, inner)] : [],
        blocks: [],
      });
    } else if (code == "}") {
      stack.length > 1
        ? stack.pop()
        : collector.add({ message: "Unexpected '}'", line });
    } else if (scanned.closes > scanned.opens && code.endsWith("}")) {
      current().items.push(item(scanned, code.substring(0, code.length - 1).trim()));
      stack.length > 1 && stack.pop();
    } else {
      current().items.push(item(scanned, code));
    }
  }

  for (const open of stack.slice(1)) {
    collector.add({
      message: `Block '${open.header}' is missing its closing '}'`,
      line: open.line,
    });
  }

  return { blocks: root.blocks, topLevel: root.items };
};
