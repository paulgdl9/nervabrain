export function normalizePastedMarkdown(value: string) {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  let fenced = false;
  const normalized: string[] = [];

  for (const [index, line] of lines.entries()) {
    normalized.push(line);
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    const next = lines[index + 1];
    if (fenced || !line.trim() || !next?.trim()) continue;
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|.*\|\s*$/.test(next)) continue;
    normalized.push("");
  }

  return normalized.join("\n");
}
