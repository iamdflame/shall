# Tasks — The SHALL Language

`[x]` complete · `[ ]` not started

## Phase 1 — The language

- [x] 1.1 Domain model: Program, Interface, ShallRequirement — _Req 1_
- [x] 1.2 `.shall` grammar and parser — _Req 1.1_
- [x] 1.3 Reuse the EARS clause parser for criteria — _Req 1.1_
- [x] 1.4 Reject programs that cannot be tested or compared — _Req 1.2, 1.3_
- [x] 1.5 Report malformed criteria without aborting the parse — _Req 1.4_
- [x] 1.6 Tests (9)

## Phase 2 — Ensemble compilation

- [x] 2.1 Provider abstraction; vendor confined to one module — _Req 2_
- [x] 2.2 OpenAI provider with parameter-rejection retry — _Req 2_
- [x] 2.3 Compiler prompt that never hints at resolution — _Req 2.2_
- [x] 2.4 Concurrent compilation with per-reader failure isolation — _Req 2.3_
- [x] 2.5 Content-addressed candidate cache — _Req 2.4_
- [x] 2.6 Roster spanning model generations — _Req 2_
- [x] 2.7 Tests with a recording provider (8)

## Phase 3 — The oracle

- [x] 3.1 `node:vm` sandbox with no host globals — _Req 6.2_
- [x] 3.2 Wall-clock timeout on every candidate call — _Req 6.3_
- [x] 3.3 Canonical outcome comparison — _Req 3.1_
- [x] 3.4 Deterministic structural probes — _Req 6.1_
- [x] 3.5 Spec-literal mining and dense sweep — _Req 6.1_
- [x] 3.6 Reserved budget for input interactions — _Req 6.1_
- [x] 3.7 Behaviour-vector partitioning — _Req 3.1, 3.2_
- [x] 3.8 Reject splits, pluralities and sub-quorum runs — _Req 3.3, 3.4, 3.5_
- [x] 3.9 Tests (13)

## Phase 4 — Evidence

- [x] 4.1 Witness inputs and per-reader results in the report — _Req 4.1, 4.2_
- [x] 4.2 Static lexicon of open wording — _Req 4.3_
- [x] 4.3 Statistical contrast between disagreeing and agreeing inputs — _Req 4.4_
- [x] 4.4 Rank named wording above correlation — _Req 4.4_
- [x] 4.5 Compiler-style diagnostic pointing at the clause — _Req 4.1_
- [x] 4.6 Tests (12)

## Phase 5 — Conformance

- [x] 5.1 Derive expectations from each clause independently — _Req 5.1_
- [x] 5.2 Keep only expectations several readers agree on — _Req 5.2_
- [x] 5.3 Report disputed expectations rather than discarding them — _Req 5.4_
- [x] 5.4 Run the built program against surviving expectations — _Req 5.3_
- [x] 5.5 Block emission on contradiction — _Req 5.3_
- [x] 5.6 Tests (12)

## Phase 6 — Toolchain

- [x] 6.1 `shall build` / `check` / `lint` / `run` / `models`
- [x] 6.2 `shall verify` — this repository against this specification
- [x] 6.3 `.env` loading with environment precedence
- [x] 6.4 Offline lint requiring no API key — _Req 6.4_
- [x] 6.5 Exit codes suitable for CI

## Phase 7 — Empirical validation

- [x] 7.1 Confirm a same-generation roster misses real ambiguity
- [x] 7.2 Rebuild the roster across generations
- [x] 7.3 Reproduce a genuine split against real readers
- [x] 7.4 Confirm disambiguation makes the same specification compile
- [x] 7.5 Reach 25/25 on this repository's own specification

## Backlog

- [ ] 8.1 Second vendor in the ensemble — the strongest remaining improvement
- [ ] 8.2 `shall watch` — re-check on save
- [ ] 8.3 Richer interface types: records, optional fields
- [ ] 8.4 Suggest a disambiguating rewrite alongside the diagnostic
- [ ] 8.5 GitHub Action publishing the ambiguity report on a pull request

## Phase 8 — Reproducibility and disambiguation

- [x] 8.1 Commit recorded ensembles; replay by default — _offline-replay 1, 2_
- [x] 8.2 `shall record`, and `--live` to re-ask — _offline-replay 1.3, 2.1_
- [x] 8.3 `npm run findings` reproduces every finding offline
- [x] 8.4 Cost preflight with reachability — _offline-replay 3_
- [x] 8.5 OpenAI-compatible provider for any vendor — _multi-vendor 1_
- [x] 8.6 Drop unreachable readers; flag a single-vendor roster — _multi-vendor 2_
- [x] 8.7 Witness minimisation — _disambiguation 1_
- [x] 8.8 `shall suggest` and `--apply` — _disambiguation 2_
- [x] 8.9 Pair attribution for clause interactions — _disambiguation 3_
- [x] 8.10 Fix: vm context reused across probes (state leaked between calls)
- [x] 8.11 Fix: float noise reported as ambiguity
- [x] 8.12 Fix: minimal witness paired with outputs from the original probe
- [x] 8.13 Fix: stacked annotations bound only the last criterion
- [x] 8.14 Fix: list inputs were probed without repetition or varied length
- [x] 8.15 CI, and a pull-request gate on changed specifications
