import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BUSINESS_STAGES,
  createBusinessInvoice,
  createBusinessProspect,
  deleteBusinessRecord,
  listBusinessRecords,
  listTrash,
  readNote,
  readBusinessSettings,
  restoreNote,
  saveBusinessSettings,
  updateBusinessInvoiceStatus,
  updateBusinessProspectStage,
} from "../src/lib/vault";

async function scratchVault(run: () => Promise<void>) {
  const previous = process.env.SECOND_BRAIN_VAULT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "second-brain-business-"));
  process.env.SECOND_BRAIN_VAULT = root;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("business records stay readable in the Markdown vault", () => scratchVault(async () => {
  assert.deepEqual(await listBusinessRecords(), []);

  const prospect = await createBusinessProspect({
    company: "Acme",
    contactName: "Sam",
    value: 5000,
    stage: "qualified",
    probability: 45,
    nextAction: "Envoyer le devis",
    nextActionDate: "2026-07-20",
  });
  const invoice = await createBusinessInvoice({
    client: "Acme",
    amount: 1200,
    issueDate: "2026-07-18",
    dueDate: "2026-08-17",
    status: "sent",
  });

  await updateBusinessProspectStage(prospect.relativePath, "won");
  await updateBusinessInvoiceStatus(invoice.relativePath, "paid");
  const records = await listBusinessRecords();
  const savedProspect = records.find((record) => record.data.record_type === "prospect");
  const savedInvoice = records.find((record) => record.data.record_type === "invoice");

  assert.equal(savedProspect?.data.stage, "won");
  assert.equal(savedProspect?.data.probability, 100);
  assert.equal(savedInvoice?.data.status, "paid");
  assert.match(String(savedInvoice?.data.invoice_number), /^FAC-2026-/);
  assert.ok(savedInvoice?.data.paid_at);
}));

test("prospects accept every stage and enforce won/lost probabilities", () => scratchVault(async () => {
  const prospect = await createBusinessProspect({
    company: "Cycle complet",
    value: 9000,
    stage: "lead",
    probability: 35,
  });

  for (const stage of BUSINESS_STAGES) {
    const updated = await updateBusinessProspectStage(prospect.relativePath, stage);
    assert.equal(updated?.data.stage, stage);
    if (stage === "won") assert.equal(updated?.data.probability, 100);
    if (stage === "lost") assert.equal(updated?.data.probability, 0);
  }
}));

test("reopening a won prospect restores the destination stage probability", () => scratchVault(async () => {
  const prospect = await createBusinessProspect({
    company: "Réouverture",
    value: 4000,
    stage: "proposal",
    probability: 60,
  });
  await updateBusinessProspectStage(prospect.relativePath, "won");
  const reopened = await updateBusinessProspectStage(prospect.relativePath, "qualified");

  assert.equal(reopened?.data.probability, 40);
}));

test("invoice lifecycle keeps paid_at aligned with the current status", () => scratchVault(async () => {
  const invoice = await createBusinessInvoice({
    client: "Lifecycle",
    amount: 750,
    issueDate: "2026-07-01",
    dueDate: "2026-07-15",
    status: "draft",
  });
  assert.equal(invoice.data.status, "draft");
  assert.equal(invoice.data.paid_at, undefined);

  const sent = await updateBusinessInvoiceStatus(invoice.relativePath, "sent");
  assert.equal(sent?.data.status, "sent");
  assert.equal(sent?.data.paid_at, undefined);

  const paid = await updateBusinessInvoiceStatus(invoice.relativePath, "paid");
  assert.equal(paid?.data.status, "paid");
  assert.match(String(paid?.data.paid_at), /^\d{4}-\d{2}-\d{2}T/);
  const firstPaidAt = paid?.data.paid_at;

  const paidAgain = await updateBusinessInvoiceStatus(invoice.relativePath, "paid");
  assert.equal(paidAgain?.data.paid_at, firstPaidAt);

  const reopened = await updateBusinessInvoiceStatus(invoice.relativePath, "sent");
  assert.equal(reopened?.data.status, "sent");
  assert.equal(reopened?.data.paid_at, undefined);

  const redrafted = await updateBusinessInvoiceStatus(invoice.relativePath, "draft");
  assert.equal(redrafted?.data.status, "draft");
  assert.equal(redrafted?.data.paid_at, undefined);
}));

test("invoice creation rejects a due date before its issue date", () => scratchVault(async () => {
  await assert.rejects(
    createBusinessInvoice({
      client: "Dates invalides",
      amount: 500,
      issueDate: "2026-07-20",
      dueDate: "2026-07-19",
    }),
    /échéance|date/i,
  );
}));

test("business goal and currency persist independently from finance", () => scratchVault(async () => {
  assert.deepEqual(await readBusinessSettings(), { currency: "EUR", monthlyRevenueGoal: 0 });
  await saveBusinessSettings({ currency: "CHF", monthlyRevenueGoal: 15000 });
  assert.deepEqual(await readBusinessSettings(), { currency: "CHF", monthlyRevenueGoal: 15000 });
}));

test("automatic invoice numbers continue after the highest existing serial", () => scratchVault(async () => {
  await createBusinessInvoice({ number: "FAC-2026-042", client: "Acme", amount: 1200, issueDate: "2026-07-18" });
  const next = await createBusinessInvoice({ client: "Beta", amount: 800, issueDate: "2026-07-19" });

  assert.equal(next.data.invoice_number, "FAC-2026-043");
  await assert.rejects(
    createBusinessInvoice({ number: "FAC-2026-042", client: "Gamma", amount: 500, issueDate: "2026-07-20" }),
    /déjà utilisé/,
  );
}));

test("automatic invoice numbering restarts for a new year", () => scratchVault(async () => {
  await createBusinessInvoice({ number: "FAC-2026-099", client: "Acme", amount: 1200, issueDate: "2026-12-31" });
  const firstNextYear = await createBusinessInvoice({ client: "Beta", amount: 800, issueDate: "2027-01-02" });
  const secondNextYear = await createBusinessInvoice({ client: "Gamma", amount: 600, issueDate: "2027-01-03" });

  assert.equal(firstNextYear.data.invoice_number, "FAC-2027-001");
  assert.equal(secondNextYear.data.invoice_number, "FAC-2027-002");
}));

test("business record deletion is recoverable through the shared trash", () => scratchVault(async () => {
  const prospect = await createBusinessProspect({ company: "À restaurer", value: 1000 });

  await deleteBusinessRecord(prospect.relativePath);
  assert.equal(await readNote(prospect.relativePath), null);
  assert.deepEqual(await listBusinessRecords(), []);

  const trash = await listTrash();
  assert.equal(trash.length, 1);
  assert.equal(trash[0]?.from, prospect.relativePath);
  assert.equal(trash[0]?.kind, "business-record");

  const restoredPath = await restoreNote(trash[0]!.trashPath);
  assert.equal(restoredPath, prospect.relativePath);
  assert.equal((await readNote(restoredPath))?.data.record_type, "prospect");
  assert.equal((await listTrash()).length, 0);
}));

test("business records preserve their own currencies without conversion", () => scratchVault(async () => {
  const eur = await createBusinessInvoice({ client: "Euro", amount: 1000, currency: "eur", issueDate: "2026-07-01", status: "paid" });
  const chf = await createBusinessInvoice({ client: "Franc", amount: 900, currency: "CHF", issueDate: "2026-07-02", status: "paid" });
  const prospect = await createBusinessProspect({ company: "Dollar", value: 1500, currency: "usd" });

  assert.equal(eur.data.currency, "EUR");
  assert.equal(chf.data.currency, "CHF");
  assert.equal(prospect.data.currency, "USD");
}));

test("business inputs reject invalid required values, amounts, currencies, and transitions", () => scratchVault(async () => {
  await assert.rejects(createBusinessProspect({ company: "", value: 100 }), /Société ou contact requis/);
  await assert.rejects(createBusinessProspect({ company: "Acme", value: -1 }), /Montant invalide/);
  await assert.rejects(createBusinessInvoice({ client: "", amount: 100 }), /Client requis/);
  await assert.rejects(createBusinessInvoice({ client: "Acme", amount: Number.NaN }), /Montant invalide/);
  await assert.rejects(createBusinessInvoice({ client: "Acme", amount: 100, currency: "EURO" }), /Devise invalide/);

  const prospect = await createBusinessProspect({ company: "Transitions", value: 100 });
  const invoice = await createBusinessInvoice({ client: "Transitions", amount: 100 });
  await assert.rejects(updateBusinessProspectStage(prospect.relativePath, "unknown"), /Étape invalide/);
  await assert.rejects(updateBusinessInvoiceStatus(invoice.relativePath, "overdue"), /Statut invalide/);
}));
