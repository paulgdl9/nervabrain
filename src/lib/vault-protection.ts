const PROTECTED_PREFIXES = [
  "00-System/",
  "08-Projects/Revisions/",
  "08-Projects/Trail-26K/",
  "08-Projects/_Template/",
  "09-Skills/",
  "11-Custom/_registry/",
];

const PROJECT_CONTROL_FILES = new Set([
  "CLAUDE.md",
  "Feedback.md",
  "Inputs.md",
  "Outputs.md",
  "Plan.md",
  "Process.md",
  "Project.md",
]);

export function isProtectedVaultPath(relativePath: string): boolean {
  const clean = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (PROTECTED_PREFIXES.some((prefix) => clean.startsWith(prefix))) return true;
  const parts = clean.split("/");
  return parts[0] === "08-Projects" && PROJECT_CONTROL_FILES.has(parts.at(-1) || "");
}
