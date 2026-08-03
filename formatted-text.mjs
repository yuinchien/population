const SUFFIX_TOKEN = /<span class="suffix">([^<]*)<\/span>/g;

// Formatters may request exactly one presentational construct: a suffix span.
// Everything else, including malformed or unexpected markup, remains text.
// This keeps data values out of the HTML parser while preserving unit spacing.
export function formattedTextParts(value) {
  const source = String(value ?? "");
  const parts = [];
  let cursor = 0;

  for (const match of source.matchAll(SUFFIX_TOKEN)) {
    if (match.index > cursor) {
      parts.push({ text: source.slice(cursor, match.index) });
    }
    parts.push({ text: match[1], className: "suffix" });
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length || parts.length === 0) {
    parts.push({ text: source.slice(cursor) });
  }
  return parts;
}

export function renderFormattedText(element, value) {
  const nodes = formattedTextParts(value).map((part) => {
    if (!part.className) return document.createTextNode(part.text);
    const span = document.createElement("span");
    span.className = part.className;
    span.textContent = part.text;
    return span;
  });
  element.replaceChildren(...nodes);
  return element;
}
