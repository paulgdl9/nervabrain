import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("notes, tasks, objectives and the dashboard keep their content usable on phones", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const trailCss = readFileSync("src/app/(shell)/training/training.css", "utf8");
  const tasks = readFileSync("src/components/TasksWorkspace.tsx", "utf8");
  const objectives = readFileSync("src/components/ObjectivesWorkspace.tsx", "utf8");

  assert.match(css, /\.markdown-table-scroll\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.obj-row\s*\{[\s\S]*?display:\s*flex/);
  assert.match(css, /\.obj-cell::before\s*\{[\s\S]*?content:\s*attr\(data-label\)/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.dashboard-layout-stage\s*\{\s*min-height:\s*0/);
  assert.match(css, /\.dashboard-layout \.check-title\s*\{[\s\S]*?white-space:\s*normal/);
  assert.match(css, /\.dashboard-module-stat span\s*\{[\s\S]*?white-space:\s*normal/);
  assert.match(css, /\.obj-cell\s*\{[\s\S]*?grid-template-columns:\s*88px minmax\(0, 1fr\)/);
  assert.match(css, /\.finance-metric-card\.is-compact \.finance-metric-plot\s*\{\s*height:\s*140px/);
  assert.match(trailCss, /@media \(max-width: 640px\)[\s\S]*?\.trail-tabs\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(trailCss, /\.trail-tab\s*\{[\s\S]*?flex:\s*1 1 0/);
  assert.match(tasks, /data-label=/);
  assert.match(objectives, /data-label=/);
});
