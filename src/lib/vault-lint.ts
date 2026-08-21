import path from "node:path";
import type { VaultNote } from "@/lib/vault";

export type VaultLintSeverity = "error" | "warning";

export type VaultLintIssue = {
  severity: VaultLintSeverity;
  code: string;
  path?: string;
  message: string;
};

export type VaultLintReport = {
  noteCount: number;
  errors: number;
  warnings: number;
  issues: VaultLintIssue[];
};

const REQUIRED_FIELDS: Record<string, string[]> = {
  capture: ["title", "type", "status", "source", "captured_at"],
  raw: ["title", "type", "status", "source"],
  wiki: ["title", "type", "status"],
  objective: ["title", "type", "status", "area", "priority"],
  task: ["title", "type", "status", "area", "priority"],
  daily: ["title", "type", "date", "generated_by"],
  weekly: ["title", "type", "week", "generated_by"],
  system: ["title", "type"],
};

const VALID_STATUSES: Record<string, Set<string>> = {
  capture: new Set(["inbox", "briefed", "needs-ai", "processed", "archived"]),
  raw: new Set(["active", "archived", "draft"]),
  wiki: new Set(["draft", "active", "archived"]),
  objective: new Set(["active", "achieved", "paused", "abandoned", "archived"]),
  task: new Set(["todo", "doing", "waiting", "active", "done", "abandoned", "archived"]),
};

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("fr-CH");
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

function sourcePaths(note: VaultNote) {
  const values = [note.data.source_note, note.data.source_notes, note.data.sources];
  return values.flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().replace(/^`|`$/g, ""))
    .filter((value) => value.endsWith(".md") && !/^https?:\/\//i.test(value));
}

function isExpectedCaptureDerivation(duplicates: VaultNote[]) {
  if (!duplicates.every((note) => note.kind === "capture" || note.kind === "wiki")) return false;
  const captures = duplicates.filter((note) => note.kind === "capture");
  const derivedSources = new Set(
    duplicates
      .filter((note) => note.kind === "wiki")
      .flatMap((note) => sourcePaths(note)),
  );
  return captures.length > 0 && captures.every((capture) => derivedSources.has(capture.relativePath));
}

function wikilinkCandidates(link: string, byTitle: Map<string, VaultNote[]>, byPath: Map<string, VaultNote>) {
  const clean = link.trim().replace(/\\/g, "/").replace(/\.md$/i, "");
  const pathCandidate = `${clean}.md`;
  const exactPath = byPath.get(pathCandidate);
  if (exactPath) return [exactPath];
  const title = path.basename(clean);
  return byTitle.get(normalized(title)) || [];
}

// Syncthing resolves concurrent edits by writing "<name>.sync-conflict-<stamp>.md"
// next to the original; some editors leave "<name> 2.md" copies behind. Both mean
// the vault's truth has silently forked into two files.
export function isSyncConflictPath(relativePath: string) {
  const base = path.basename(relativePath, ".md");
  return /\.sync-conflict-\d{8}-\d{6}/.test(base) || /\s\d+$/.test(base);
}

export function lintVaultNotes(allNotes: VaultNote[]): VaultLintReport {
  const issues: VaultLintIssue[] = [];
  // _Archive holds moved historical files (archived dailies, resolved sync
  // conflicts). They stay resolvable as link/source targets, but their own
  // hygiene is frozen history: linting them would permanently re-flag every
  // duplicate title and conflict copy that was already dealt with.
  const notes = allNotes.filter((note) => !note.relativePath.startsWith("_Archive/"));
  const byPath = new Map(allNotes.map((note) => [note.relativePath, note]));
  const byTitle = new Map<string, VaultNote[]>();
  const tagVariants = new Map<string, Set<string>>();

  for (const note of notes) {
    const key = normalized(note.title);
    byTitle.set(key, [...(byTitle.get(key) || []), note]);
    for (const tag of note.tags) {
      const tagKey = normalized(tag);
      const variants = tagVariants.get(tagKey) || new Set<string>();
      variants.add(tag);
      tagVariants.set(tagKey, variants);
    }
  }

  for (const note of notes) {
    if (isSyncConflictPath(note.relativePath)) {
      issues.push({
        severity: "error",
        code: "sync.conflict",
        path: note.relativePath,
        message: "Sync conflict copy detected: merge it into the original, then archive this file.",
      });
    }

    const required = REQUIRED_FIELDS[note.kind];
    if (required) {
      for (const field of required) {
        const value = field === "title" ? note.title : note.data[field];
        if (!hasValue(value)) {
          issues.push({
            severity: "warning",
            code: "schema.missing-field",
            path: note.relativePath,
            message: `Missing required ${note.kind || "note"} field: ${field}`,
          });
        }
      }
    }

    const validStatuses = VALID_STATUSES[note.kind];
    if (note.status && validStatuses && !validStatuses.has(note.status)) {
      issues.push({
        severity: "warning",
        code: "schema.invalid-status",
        path: note.relativePath,
        message: `Unexpected ${note.kind} status: ${note.status}`,
      });
    }

    for (const sourcePath of sourcePaths(note)) {
      if (!byPath.has(sourcePath)) {
        issues.push({
          severity: "error",
          code: "source.missing",
          path: note.relativePath,
          message: `Source path does not exist: ${sourcePath}`,
        });
      }
    }

    for (const link of note.links) {
      const candidates = wikilinkCandidates(link, byTitle, byPath);
      if (candidates.length === 0) {
        issues.push({
          severity: "error",
          code: "wikilink.broken",
          path: note.relativePath,
          message: `Broken wikilink: [[${link}]]`,
        });
      } else if (candidates.length > 1) {
        issues.push({
          severity: "warning",
          code: "wikilink.ambiguous",
          path: note.relativePath,
          message: `Ambiguous wikilink [[${link}]] matches ${candidates.length} notes`,
        });
      }
    }
  }

  for (const duplicates of byTitle.values()) {
    if (duplicates.length < 2 || isExpectedCaptureDerivation(duplicates)) continue;
    issues.push({
      severity: "warning",
      code: "title.duplicate",
      message: `Duplicate title "${duplicates[0].title}": ${duplicates.map((note) => note.relativePath).join(", ")}`,
    });
  }

  for (const variants of tagVariants.values()) {
    if (variants.size < 2) continue;
    issues.push({
      severity: "warning",
      code: "tag.inconsistent-case",
      message: `Tag casing is inconsistent: ${[...variants].sort().join(", ")}`,
    });
  }

  issues.sort((a, b) => (
    a.severity.localeCompare(b.severity)
    || (a.path || "").localeCompare(b.path || "")
    || a.code.localeCompare(b.code)
  ));
  return {
    noteCount: notes.length,
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
    issues,
  };
}
