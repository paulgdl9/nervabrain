export function stripTaskMetaComments(content: string) {
  return content.replace(/[ \t]*<!--\s*task-meta\b[\s\S]*?-->[ \t]*/g, "");
}

export function setMarkdownChecklistState(content: string, index: number, checked: boolean) {
  if (!Number.isInteger(index) || index < 0) return null;
  const lines = content.split("\n");
  let current = 0;
  let fence = "";
  let changed = false;

  const next = lines.map((line) => {
    const fenceMatch = line.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const run = fenceMatch[1];
      if (!fence) fence = run;
      else if (run[0] === fence[0] && run.length >= fence.length && !fenceMatch[2].trim()) fence = "";
      return line;
    }
    if (fence) return line;

    return line.replace(/^((?:[ \t]*>[ \t]*)*[ \t]*(?:[-+*]|\d+[.)])[ \t]+\[)([ xX])(\])/, (marker, before: string, _state: string, after: string) => {
      if (current++ !== index) return marker;
      changed = true;
      return `${before}${checked ? "x" : " "}${after}`;
    });
  });

  return changed ? next.join("\n") : null;
}

function plainNoteTitle(value: string) {
  return (value.split("/").pop() || value).replace(/\.md(?:#.*)?$/i, "").trim();
}

/** Keep generated briefs readable while provenance stays in frontmatter. */
export function sanitizeBriefOutput(content: string) {
  const lines: string[] = [];
  let omittedHeadingLevel = 0;

  for (const line of stripTaskMetaComments(content).split(/\r?\n/)) {
    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
    if (omittedHeadingLevel) {
      if (!heading || heading[1].length > omittedHeadingLevel) continue;
      omittedHeadingLevel = 0;
    }
    if (heading && /^[^\p{L}\p{N}]*(?:sources?|références?)\s*:?\s*$/iu.test(heading[2])) {
      omittedHeadingLevel = heading[1].length;
      continue;
    }
    lines.push(line);
  }

  return lines.join("\n")
    .replace(/\[([^\]\n]+)\]\(([^)\n]*\.md(?:#[^)\n]*)?)\)/gi, "$1")
    .replace(/\[\[([^\]\n]+)\]\]/g, (_, inner: string) => {
      const [target, label] = inner.split("|", 2);
      return plainNoteTitle(label || target.split("#", 1)[0]);
    })
    .replace(/\[(?:Task|Journal|Daily Brief|Objective|Library|Capture|Project|Source)\s*:[^\]\n]+\]\s*/gi, "")
    .replace(/`([^`\n]*\.md(?:#[^`\n]*)?)`/gi, (_, note: string) => plainNoteTitle(note))
    .replace(
      /(^|[\s(])((?:\.{0,2}\/)*(?:_Archive|(?:0\d|1[0-2])-[A-Za-zÀ-ÿ0-9_-]+|vault)\/[^\n`),;]+?\.md(?:#[^\s`),;]+)?)/gim,
      (_, before: string, note: string) => `${before}${plainNoteTitle(note)}`,
    )
    .replace(
      /(^|[\s(])((?:\.{1,2}\/)?(?:[A-Za-z0-9À-ÿ_.@+-]+\/)+[A-Za-z0-9À-ÿ_.@+-]+\.md(?:#[A-Za-z0-9À-ÿ_.@+/-]+)?)(?=$|[\s),.;:!?])/gim,
      (_, before: string, note: string) => `${before}${plainNoteTitle(note)}`,
    )
    .replace(/\b([A-Za-z0-9À-ÿ_.@+-]+)\.md\b/gi, "$1")
    .replace(/\s*(?:Tâche\s+source|Sources?|Références?)\s*:\s*(?=[,.;!?]|$)/gim, "")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/(?:\n[ \t]*){3,}/g, "\n\n")
    .trim();
}
