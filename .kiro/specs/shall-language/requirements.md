# Requirements — The SHALL Language

## Document Information

- **Feature Name**: SHALL — a language whose source code is English
- **Version**: 1.0
- **Date**: 2026-08-22
- **Stakeholders**: Authors writing specifications; reviewers who must trust one

## Introduction

Spec-driven development asks people to write requirements in English and then
hands those requirements to a model. The unexamined assumption is that the
English says one thing. It very often says two, and nobody finds out until the
implementation is in production behaving in a way nobody specified.

SHALL treats that assumption as testable. A `.shall` program is a specification,
its acceptance criteria are the source code, and the compiler is an ensemble of
independent readers. When the readers implement the same specification and
produce programs that behave differently, the specification did not determine
the behaviour, and the build fails with the offending sentence underlined.

Agreement is necessary but not sufficient. Readers can agree on a behaviour the
author never asked for, so a second pass derives test cases from each clause and
runs the built program against them. Consensus asks whether the English was
understood the same way; conformance asks whether that shared understanding is
the one that was written down.

### Feature Summary

Compiles English acceptance criteria into a working program, and rejects the
compile when independent readers disagree about what the English requires.

### Business Value

Requirements ambiguity is found today by shipping it. This finds it before a
line of production code is written, at the cost of a few model calls.

### Scope

In scope: parsing, ensemble compilation, differential consensus, attribution,
conformance, reproducible builds.
Out of scope: writing specifications, repairing them automatically, or ranking
one reader's interpretation above another's.

## Requirements

### Requirement 1: Program ingestion

**User Story:** As an author, I want my English requirements parsed into a program, so that the specification itself is the source code.

#### Acceptance Criteria

1. WHEN a `.shall` file declares a program THEN the system SHALL parse its interface and every acceptance criterion
2. IF a program declares no inputs THEN the system SHALL reject it, because nothing could be tested
3. IF a program declares more than one output THEN the system SHALL reject it, because nothing could be compared
4. WHERE a criterion is not valid EARS the system SHALL report it without aborting the parse

### Requirement 2: Ensemble compilation

**User Story:** As an author, I want several independent readers to implement my specification, so that their disagreement can be measured.

#### Acceptance Criteria

1. WHEN a program is compiled THEN the system SHALL send byte-identical instructions and input to every reader
2. THE SYSTEM SHALL NOT inform any reader that other readers exist
3. IF a reader fails THEN the system SHALL record the failure and continue with the remaining readers
4. WHEN a reader has already answered for an unchanged program THEN the system SHALL reuse the cached answer

### Requirement 3: Differential consensus

**User Story:** As an author, I want readers compared by behaviour, so that stylistic differences are not mistaken for disagreement.

#### Acceptance Criteria

1. WHEN candidates are compared THEN the system SHALL compare observed behaviour rather than source text
2. WHEN every loadable candidate behaves identically on every probe THEN the system SHALL report the specification as unambiguous
3. IF candidates behave differently on any probe THEN the system SHALL reject the build
4. IF a majority of readers agree THEN the system SHALL still reject the build, because a plurality does not settle a specification
5. IF fewer candidates load than the configured quorum THEN the system SHALL reject the build

### Requirement 4: Evidence and attribution

**User Story:** As an author, I want the failing sentence named, so that I know which words to change.

#### Acceptance Criteria

1. WHEN a build is rejected for disagreement THEN the system SHALL report a concrete input on which the readers differed
2. WHEN a build is rejected for disagreement THEN the system SHALL report which reader produced which result
3. WHERE a clause contains wording known to leave behaviour open the system SHALL name that wording
4. THE SYSTEM SHALL rank a clause with named open wording above a clause implicated only by correlation

### Requirement 5: Conformance

**User Story:** As a reviewer, I want the built program tested against each clause, so that agreement is not mistaken for correctness.

#### Acceptance Criteria

1. WHEN readers have agreed THEN the system SHALL derive test cases from each acceptance criterion
2. THE SYSTEM SHALL retain a derived expectation only when several readers independently propose the same expected value
3. IF the built program contradicts a derived expectation THEN the system SHALL reject the build
4. IF no expectation for a criterion survives agreement THEN the system SHALL report that criterion as undetermined rather than satisfied

### Requirement 6: Reproducibility

**User Story:** As a reviewer, I want a build I can reproduce, so that a report is evidence rather than an anecdote.

#### Acceptance Criteria

1. WHEN probes are generated for an unchanged program THEN the system SHALL produce the same probes every time
2. THE SYSTEM SHALL execute every candidate in an isolated sandbox with no access to the host environment
3. IF a candidate does not terminate THEN the system SHALL stop it and record the failure
4. WHERE no API key is available the system SHALL still report open wording found by static analysis

## Non-Functional Requirements

### Reliability Requirements
- IF a cached artifact cannot be read THEN the system SHALL recompute it rather than fail

### Usability Requirements
- WHEN a build is rejected THEN the system SHALL exit with a non-zero status

## Success Criteria

### Definition of Done
- [ ] An ambiguous specification is rejected with the responsible clause named
- [ ] Disambiguating that clause makes the same specification compile
- [ ] Both outcomes are reproduced against real, independent readers

## Glossary

| Term | Definition |
|------|------------|
| Reader | One model in the ensemble, compiling the specification independently |
| Probe | An input every candidate is executed against |
| Behaviour vector | A candidate's results across all probes, used to group candidates |
| Consensus | All loadable candidates sharing one behaviour vector |
| Conformance | The built program satisfying expectations derived from each clause |
