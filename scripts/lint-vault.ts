import { listAllNotes, vaultRoot } from "../src/lib/vault";
import { lintVaultNotes } from "../src/lib/vault-lint";

const json = process.argv.includes("--json");
const report = lintVaultNotes(await listAllNotes({ includeArchive: true }));

if (json) {
  console.log(JSON.stringify({ vault: vaultRoot(), ...report }, null, 2));
} else {
  console.log(`Vault: ${vaultRoot()}`);
  console.log(`${report.noteCount} notes, ${report.errors} error(s), ${report.warnings} warning(s)`);
  for (const issue of report.issues) {
    const location = issue.path ? ` ${issue.path}` : "";
    console.log(`${issue.severity === "error" ? "ERROR" : "WARN "} [${issue.code}]${location}: ${issue.message}`);
  }
}

if (report.errors > 0) process.exitCode = 1;
