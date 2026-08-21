---
name: verify-ui
description: "Verify a UI change with measured evidence instead of code-reading: render the affected routes headless at 390×844 and ≥1280, screenshot both, measure horizontal overflow, tap targets, focus states, and console errors, and drive the changed flow by clicking and typing. Use before calling any UI change done, when the user reports a visual or mobile bug, or whenever a claim about how the app looks needs proof."
---

# Verify UI

## Goal

Replace "looks right" with evidence. The deliverable of this skill is a set of
screenshots, measured numbers, and driven interactions that either prove the UI
quality bar (repository contract, "UI change" section) or name the exact
failure. It exists because the two most repeated failure modes in this
repository are the desktop-only fix and the cache excuse: UI changes verified
only wide, and unreproduced phone bugs blamed on the user's browser.

## When to run

- Any change touching `src/app/`, `src/components/`, `globals.css`, a route
  CSS file, or a `*.module.css`.
- Any user report of a visual, layout, or mobile bug, before proposing a
  cause.
- Any claim in a report like "the page renders correctly" — the claim requires
  this skill's evidence.

## Environment

1. **Never verify against the production container.** Production holds this
   profile's host port (3000) and the real vault. Check `docker compose ps`
   first; leave everything it lists alone.
2. Start a local server on a free port: `PORT=3100 npm run dev`, or
   `npm run build && PORT=3100 npm run start` when the change is risky or the
   evidence will be cited as final.
3. If the verification will exercise any write path (creating notes, changing
   statuses, submitting forms), point the server at a scratch vault first:
   `SECOND_BRAIN_VAULT=/tmp/<scratch>/vault npm run seed`, then start the
   server with the same variable. The default vault is the user's real second
   brain. Read-only page rendering may use the default vault.
4. Kill the server and remove the scratch vault when done. Never
   `pkill -f next` without checking what else is running.

## Login

If the environment used sets `DASHBOARD_PASSWORD`, the shell can pass it to
the browser step without disclosing it (for example, read it from `.env` into
a variable and type it into the `/login` form field). Never print the
password, the session cookie, or any `.env` value into the transcript, a
screenshot filename, or a report. A scratch vault started without
`DASHBOARD_PASSWORD` needs no login.

## Tooling

Use the browser tooling available in the run: the gstack `/browse` skill when
present, otherwise any headless browser the environment provides. The tool
does not matter; the measurements below do. If no browser tooling is available
at all, stop and say so — do not substitute code reading for rendering and do
not claim the checks passed.

## Procedure

Run mobile first, then desktop. For each affected route:

### 1. Mobile pass (390×844)

- Set the viewport to 390×844 and load the route (log in if required).
- Measure overflow:
  `document.documentElement.scrollWidth <= window.innerWidth` must be true.
  When it is false, find the offender before touching CSS:
  iterate elements and report those whose
  `getBoundingClientRect().right > window.innerWidth`, with their selectors.
- Take a full-page screenshot and save it under the run's scratch directory
  with a name that encodes route and viewport (for example
  `trail-390x844.png`).
- Read the browser console: zero errors is the bar. Warnings are reported but
  do not block.
- Look at the screenshot: no clipped text, no overlapping elements, no
  truncated controls. A screenshot nobody looked at is not evidence.

### 2. Desktop pass (≥1280 wide)

Repeat every mobile check at 1280×800 or wider.

### 3. Interaction pass (when behavior changed)

- Drive the changed flow with real clicks and keystrokes: open the dialog,
  submit the form, toggle the control. Reading the handler is not driving it.
- For each new interactive element: its bounding box is at least 44×44 px, and
  tabbing to it shows a visible `:focus-visible` style (computed outline or
  box-shadow not `none`).
- Re-read the console after interacting.

### 4. Theme pass (when colors or surfaces were touched)

Switch the app theme through its own UI (settings) and repeat the screenshot
at both viewports in the other theme. Check contrast and that no hardcoded
color survives only in one theme.

### 5. The twin sweep

If the verified fix lives in a component with a known twin
(`TasksWorkspace`/`ObjectivesWorkspace`; `/note`, `/doc`, `/edit` note
rendering), render the twin route once at 390×844 as well: the copied bug is
the rule, not the exception.

## Reproducing a reported bug

When the user reports a bug you cannot reproduce by reading code, reproduce it
by rendering, at the user's viewport if known, otherwise at 390×844. Never
conclude "browser cache", "stale service worker", or "their device" without
having rendered the same route at the same viewport and interacted with the
same element. If after that the bug still does not reproduce, the report must
state exactly what was rendered: route, viewport, theme, login state, data
state, and what was observed instead.

## Report

End with one table: route × viewport × overflow result (with the two measured
numbers) × console errors × screenshot path — plus one line per driven
interaction and its outcome, and one line per theme checked. Name anything not
verified and why. Screenshots are kept in the scratch directory and offered to
the user; they are the proof the quality bar asks for.
