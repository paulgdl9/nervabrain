import { ensureVault, vaultRoot } from "../src/lib/vault";

await ensureVault();
console.log(`Vault ready: ${vaultRoot()}`);
