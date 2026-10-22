/** Parsers for the small "batch input" popover and clipboard paste. */
export function parseGrid(text) {
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n").replace(/\s+$/g, "");
  if (!normalized.trim()) return [[""]];
  const lines = normalized.split("\n");
  const hasTab = lines.some((line) => line.includes("\t"));
  let rows;
  if (hasTab) {
    rows = lines.map((line) => line.split("\t").map((cell) => cell.trim()));
  } else {
    rows = lines.map((line) => splitLoose(line));
  }
  if (!rows.length) rows = [[""]];
  const width = Math.max(1, ...rows.map((row) => row.length));
  return rows.map((row) => {
    const next = row.slice(0, width);
    while (next.length < width) next.push("");
    return next;
  });
}

function splitLoose(line) {
  const text = String(line ?? "").trim();
  if (!text) return [""];
  if (/[,，]/.test(text)) {
    return text.split(/[,，]\s*/).map((cell) => cell.trim());
  }
  return text.split(/\s+/).filter((cell) => cell.length > 0);
}

export function gridToText(grid) {
  return (grid || []).map((row) => row.join("\t")).join("\n");
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
  return String(text ?? "")
    .split(/[\s,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function setToText(items) {
  return (items || []).join(", ");
}
