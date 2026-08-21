import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WeeklyActivityMiniChart } from "../src/components/WeeklyActivityMiniChart";

test("the weekly chart exposes a real activity detail by default", () => {
  const html = renderToStaticMarkup(<WeeklyActivityMiniChart points={[
    { id: "run-1", day: "mar", date: "mar. 14 juil.", name: "Course facile", value: 4.4, formatted: "4,4 km", detail: "28 min · 4,4 km" },
    { id: "run-2", day: "jeu", date: "jeu. 16 juil.", name: "Course tempo", value: 5.1, formatted: "5,1 km", detail: "32 min · 5,1 km" },
  ]} />);

  assert.match(html, /Course tempo/);
  assert.match(html, /5,1 km/);
  assert.match(html, /32 min · 5,1 km/);
});
