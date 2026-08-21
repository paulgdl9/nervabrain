import { reprocessWikiNotes } from "../src/lib/vault";

const result = await reprocessWikiNotes();
console.log(`Reprocessed ${result.rebuilt.length} local wiki note(s):`);
for (const path of result.rebuilt) console.log(`  - ${path}`);
console.log(`Skipped ${result.skipped.length} note(s) to preserve contents/provenance:`);
for (const item of result.skipped) console.log(`  - ${item.path}: ${item.reason}`);
