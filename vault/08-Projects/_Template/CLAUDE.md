# Project contract: PROJECT_NAME

## Mission

Operate this project toward the outcome and definition of done recorded in
[Project](./Project.md). Never infer a goal, audience, deadline, or constraint
that is not written in this workspace or an identified source note.

## Read order

1. The [repository contract](../../../CLAUDE.md).
2. [Project](./Project.md) — scope and current status.
3. [Inputs](./Inputs.md) — before any factual claim.
4. [Process](./Process.md) — before changing the plan.
5. [Outputs](./Outputs.md) and [Feedback](./Feedback.md) — before proposing
   another iteration.

Load [System Context](../../00-System/Context.md) only when personal or
cross-project context is necessary, and cite it instead of copying the profile
into this folder.

## IPOF loop

| Note | Holds |
| --- | --- |
| `Inputs.md` | evidence and unresolved assumptions |
| `Process.md` | decisions, work in progress, blockers |
| `Outputs.md` | inspectable deliverables and acceptance evidence |
| `Feedback.md` | actual observed signals, fed into the next cycle |

Never collapse these into a single progress narrative. A planned output is not
an output, and an interpretation is not feedback evidence.

## Working rules

- Keep changes scoped to this project unless the task explicitly requires a
  shared Wiki, Objective, Task, or System update.
- Link every important claim to a project input or a vault source.
- Mark missing information explicitly and add it as an open question.
- Preserve source material and concurrent edits.
- Update `updated` in every note whose content changes.
- Use relative links inside this folder.

## Before declaring work complete

- `Project.md` carries the current `Now`, `Next`, and blockers.
- Material decisions are recorded in `Process.md`.
- Every completed artifact is linked from `Outputs.md`.
- Measured or observed results are in `Feedback.md` when they exist.
- Every local Markdown link resolves.
