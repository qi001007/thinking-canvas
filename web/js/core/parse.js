/** Parsers for code-like batch input and clipboard paste. */

const OPENERS = new Set(["[", "(", "{"]);
const CLOSERS = new Set(["]", ")", "}"]);
const QUOTES = new Set(["'", '"']);

export function parseGrid(text) {
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [[""]];

  const outer = singleOuterList(normalized);
  if (outer !== null) return normalizeGrid(parseListBody(outer));

  const nonEmpty = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (nonEmpty.length > 1 && nonEmpty.every((line) => singleOuterList(line) !== null)) {
    return normalizeGrid(nonEmpty.map((line) => parseRowBody(singleOuterList(line))));
  }

  const lines = normalized.split("\n");
  const hasTab = lines.some((line) => line.includes("\t"));
  let rows;
  if (hasTab) {
    rows = lines.map((line) => line.split("\t").map(unquote));
  } else {
    rows = lines.map((line) => splitLoose(line).map(unquote));
  }
  return normalizeGrid(rows);
}

function normalizeGrid(rows) {
  const out = (rows || []).map((row) => (row.length ? row : [""]));
  if (!out.length) out.push([""]);
  const width = Math.max(1, ...out.map((row) => row.length));
  return out.map((row) => {
    const next = row.slice(0, width);
    while (next.length < width) next.push("");
    return next;
  });
}

function singleOuterList(text) {
  const value = String(text ?? "").trim();
  if (!OPENERS.has(value[0])) return null;
  const close = value[0] === "[" ? "]" : value[0] === "(" ? ")" : "}";
  let depth = 0;
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (QUOTES.has(char)) {
      quote = char;
      continue;
    }
    if (char === value[0]) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index === value.length - 1 ? value.slice(1, -1) : null;
    }
  }
  return null;
}

function parseListBody(body) {
  const parts = splitTopLevel(body);
  if (!parts.length) return [[""]];
  const nested = parts.some((part) => singleOuterList(part) !== null);
  if (nested) {
    return parts.map((part) => {
      const inner = singleOuterList(part);
      if (inner !== null) return parseRowBody(inner);
      return parseScalarCells(part);
    });
  }
  return [parts.flatMap((part) => parseScalarCells(part))];
}

function parseRowBody(body) {
  const parts = splitTopLevel(body);
  if (!parts.length) return [""];
  return parts.flatMap((part) => parseScalarCells(part));
}

function parseScalarCells(part) {
  const text = String(part ?? "").trim();
  if (!text) return [""];
  if (isQuoted(text)) return [unquote(text)];
  return splitLoose(text).map(unquote);
}

function splitTopLevel(body) {
  const parts = [];
  let current = "";
  let depth = 0;
  let quote = null;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      current += char;
      if (char === "\\") {
        const next = body[index + 1];
        if (next !== undefined) current += next;
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (QUOTES.has(char)) {
      quote = char;
      current += char;
      continue;
    }
    if (OPENERS.has(char)) {
      depth += 1;
      current += char;
      continue;
    }
    if (CLOSERS.has(char)) {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }
    if (depth === 0 && (char === "," || char === ";" || char === "\n")) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function splitLoose(line) {
  const text = String(line ?? "").trim();
  if (!text) return [""];
  if (/[,，]/.test(text)) {
    return text.split(/[,，]\s*/).map((cell) => cell.trim());
  }
  return text.split(/\s+/).filter((cell) => cell.length > 0);
}

function isQuoted(text) {
  return text.length >= 2 && QUOTES.has(text[0]) && text[text.length - 1] === text[0];
}

function unquote(token) {
  const text = String(token ?? "").trim();
  if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.length >= 2 && text[0] === "'" && text[text.length - 1] === "'") {
    return text.slice(1, -1);
  }
  return text;
}

export function gridToText(grid) {
  return (grid || []).map((row) => row.join("\t")).join("\n");
}

export function gridToCode(grid) {
  const rows = grid || [];
  if (!rows.length) return "[]";
  if (rows.length === 1) return `[${rows[0].map(cellCode).join(", ")}]`;
  return `[${rows.map((row) => `[${row.map(cellCode).join(", ")}]`).join(", ")}]`;
}

function cellCode(value) {
  const text = String(value ?? "");
  if (/^[^\s,"'`()[\]{}]+$/.test(text)) return text;
  return JSON.stringify(text);
}

export function parseEntries(text) {
  const lines = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [{ key: "", value: "" }];
  return lines.map((line) => {
    if (line.includes("\t")) {
      const [key, ...rest] = line.split("\t");
      return { key: key.trim(), value: rest.join("\t").trim() };
    }
    const match = line.match(/^([^:：]+)[:：]\s*(.*)$/);
    if (match) return { key: match[1].trim(), value: match[2].trim() };
    const parts = line.split(/\s+/);
    if (parts.length >= 2) return { key: parts[0], value: parts.slice(1).join(" ") };
    return { key: line, value: "" };
  });
}

export function entriesToText(entries) {
  return (entries || []).map((entry) => `${entry.key}: ${entry.value}`).join("\n");
}

export function parseSet(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  const outer = singleOuterList(raw);
  const parts = outer !== null ? splitTopLevel(outer) : raw.split(/[\s,，]+/);
  return parts
    .flatMap((part) => {
      const inner = singleOuterList(part);
      if (inner !== null) return splitTopLevel(inner);
      return [part];
    })
    .map(unquote)
    .filter(Boolean);
}

export function setToText(items) {
  return (items || []).join(", ");
}