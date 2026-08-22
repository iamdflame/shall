# Requirements — Disambiguation

## Introduction

Proving a sentence underdetermined and stopping leaves the author to work out
which behaviour they meant and how to say so. The ensemble has already done most
of that work: each behaviour group is a coherent reading, and the divergent
probes show what separates them.

A proposed rewrite is a model call and is untrusted. The check that it works is
the deterministic oracle. Suggestion is cheap and fallible; proof is not.

## Requirements

### Requirement 1: Minimal witnesses

**User Story:** As an author, I want the smallest input that reproduces the problem, so that nothing else in it can be blamed.

#### Acceptance Criteria

1. WHEN a disagreement is reported THEN the system SHALL shrink its witness while the readers still disagree
2. THE SYSTEM SHALL measure a minimal witness and its outputs together, so that a reported input and output always correspond
3. IF shrinking finds nothing smaller THEN the system SHALL report the original witness unchanged

### Requirement 2: Proposing a rewrite

**User Story:** As an author, I want each reading offered as a sentence I could adopt, so that the report ends in a decision.

#### Acceptance Criteria

1. WHEN readers split THEN the system SHALL propose one rewrite for each distinct reading
2. WHEN a rewrite is proposed THEN the system SHALL show the input and the output that reading produces
3. IF a proposal fails THEN the system SHALL drop that reading rather than abandoning the others
4. WHEN a rewrite is applied THEN the system SHALL write it into the specification and re-check it

### Requirement 3: Interaction ambiguity

**User Story:** As an author, I want to know when two clauses conflict, so that "no single clause is responsible" is not a dead end.

#### Acceptance Criteria

1. IF no single clause accounts for the disagreements THEN the system SHALL look for a pair of clauses that does
2. THE SYSTEM SHALL rank a candidate pair by how much of the disagreement it accounts for
3. WHERE a specification has very many clauses the system SHALL NOT attempt a pair search
