# ZingBee Ultra — documentation layout

| Folder | Holds |
|---|---|
| `design/` | design specs, date-stamped `YYYY-MM-DD-topic.md` |
| `plans/` | implementation plans, date-stamped (task-by-task) |
| `contracts/` | `REGISTRY.md` (the index of system contracts) + contract docs |
| `architecture/` | living architecture references |
| `legal/`, `icons/` | unchanged |

**Rule:** load-bearing, machine-readable contract *data* (files code reads at
runtime) lives WITH the code that consumes it (e.g. `api/state_machine/`), NOT
in `docs/`. `docs/` holds human prose.
