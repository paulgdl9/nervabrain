import assert from "node:assert/strict";
import test from "node:test";
import { filterWorkspaceHistory, isWorkspaceHistory } from "../src/lib/workspace-history";

test("active workspace views hide every terminal status until history is requested", () => {
  const objectives = ["active", "paused", "achieved", "completed", "abandoned", "archived"].map((status) => ({ status }));
  const tasks = ["todo", "doing", "waiting", "done", "completed", "abandoned", "archived", "cancelled"].map((status) => ({ status }));

  assert.deepEqual(filterWorkspaceHistory("objective", objectives, false).map(({ status }) => status), ["active", "paused"]);
  assert.deepEqual(filterWorkspaceHistory("task", tasks, false).map(({ status }) => status), ["todo", "doing", "waiting"]);
  assert.equal(filterWorkspaceHistory("objective", objectives, true).length, objectives.length);
  assert.equal(filterWorkspaceHistory("task", tasks, true).length, tasks.length);
  assert.equal(isWorkspaceHistory("task", " DONE "), true);
});
