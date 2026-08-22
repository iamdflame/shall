---
inclusion: always
---

# Structure

```
src/
  shall/
    lang/        .shall grammar -> Program
    provider/    the only vendor-aware layer
    compile/     ensemble compilation, prompt, cache
    execute/     node:vm sandbox and canonical value comparison
    oracle/      probe generation and differential execution
    attribute/   divergence -> the responsible clause
    conform/     expectations derived per clause, and the check
    report/      terminal diagnostics
    cli.ts       command dispatch
  ears/          EARS clause parser, shared with .kiro specs
  binding/       @shall annotation scanner (used by `shall verify`)
  verify/        spec conformance engine (used by `shall verify`)
  lock/          verified-state baseline
  report/        spec conformance reporting
```

## Dependency direction

`lang`, `execute`, `ears` depend on nothing. `oracle` depends on `execute`.
`compile` depends on `provider` and `lang`. `conform` depends on `execute`.
`report` depends on the layers it renders. `cli` depends on everything.
Layers never reach upward, and nothing outside `provider/` imports a vendor SDK.

## Conventions

- Comments explain **why**, never what. A comment restating the code is deleted.
- One module decides each verdict: `oracle/differential.ts` decides consensus,
  `conform/check.ts` decides conformance. Nothing else assigns a status.
- Every acceptance criterion in `.kiro/specs/` carries a `// @shall <id>`
  annotation on the code implementing it and on the test proving it.
- Tests import from `dist/`, so they exercise the shipped artifact.

## Naming

- A **reader** is one ensemble member. Not "model", not "agent".
- A **probe** is one input all candidates are executed against.
- A **behaviour vector** is a candidate's results across all probes.
- **Consensus** is agreement between readers; **conformance** is agreement with
  the specification. They are never used interchangeably.
