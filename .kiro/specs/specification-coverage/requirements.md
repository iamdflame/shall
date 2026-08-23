# Requirements — Specification coverage

## Introduction

A green build says the readers agreed on every probe. It does not say every
clause was tested, and those are different claims. If no probe ever engaged
clause 3.2, unanimity across six readers tells you nothing whatsoever about
clause 3.2 — and a report that stays silent lets a passing result imply more
than it earned.

Code coverage answers the same question about lines. Nothing answered it about
requirements, which is the harder and more useful version: lines are the
implementation's business, but a clause nobody exercised is the author's.

The sharper question is not whether a rule ran but whether it ran *where it
turns*. "IF five dice show the same face" can be engaged by ninety probes and
still be untested if none of them held four and none held six. Every off-by-one
an English specification can hide lives at that edge, and so does most of the
disagreement between readers.

Deciding whether a clause was engaged is a judgement, and every way of being
wrong about it matters. Over-count and coverage inflates until the number means
nothing. Under-count and the report cries wolf until the author stops reading
it. The rules below were each written because a plausible one failed.

## Requirements

### Requirement 1: Reporting what was exercised

**User Story:** As an author, I want to know which clauses the run actually tested, so that I do not read a green result as a stronger guarantee than it is.

#### Acceptance Criteria

1. THE SYSTEM SHALL report, for every well-formed criterion, how many probes engaged it
2. WHEN a criterion is engaged by no probe THEN the system SHALL name it in the report rather than counting it as verified
3. THE SYSTEM SHALL report coverage on an accepted build as well as a rejected one, so that agreement is never presented without its scope
4. IF a criterion failed to parse THEN the system SHALL exclude it from coverage, so that one mistake is not reported twice

### Requirement 2: Deciding what a clause refers to

**User Story:** As an author, I want a clause matched to the inputs it talks about, even when it does not use the interface's exact words, so that the report does not invent gaps.

#### Acceptance Criteria

1. THE SYSTEM SHALL match a clause's words to an input's name after reducing both to a common stem, so that "each remaining die" reaches an input named `dice`
2. WHERE a criterion names exactly one input, THE SYSTEM SHALL treat its remaining nouns as vocabulary for that input
3. THE SYSTEM SHALL exclude a clause's response verb from that vocabulary, because it names an action rather than an input
4. IF two criteria bind the same word to different inputs THEN the system SHALL treat the word as a coincidence and bind it to neither
5. THE SYSTEM SHALL match an input's declared name as written, so that a name too short to survive stemming is not invisible
6. THE SYSTEM SHALL walk into records and lists when matching, so that a clause naming a field engages the value inside

### Requirement 3: Clauses no lexical rule can reach

**User Story:** As an author, I want a catch-all rule to be understood as a catch-all, so that the report does not flag it on every specification that has one.

#### Acceptance Criteria

1. WHEN a criterion's guard states that no other rule applies THEN the system SHALL treat it as a fallback
2. THE SYSTEM SHALL consider a fallback engaged by exactly the probes that engage no other criterion
3. THE SYSTEM SHALL use one engagement result for both coverage and attribution, so that the two can never disagree about what a run exercised

### Requirement 4: Boundaries

**User Story:** As an author, I want to know whether the numbers my requirements state were actually probed, so that an off-by-one cannot hide behind a covered clause.

#### Acceptance Criteria

1. THE SYSTEM SHALL treat every number in a criterion's guard as a boundary
2. WHERE a number appears outside a guard, THE SYSTEM SHALL treat it as a boundary only if comparison wording accompanies it
3. THE SYSTEM SHALL report a boundary as tested only when probes sit below it, on it, and above it
4. THE SYSTEM SHALL measure a string or a list by its length and a number by its value, so that one boundary reads correctly against every type
5. IF a type carries no single magnitude THEN the system SHALL report no boundary for it rather than probe an arbitrary axis

### Requirement 5: Closing the gap

**User Story:** As an author, I want the tool to test the boundaries my requirements state, so that finding them is not left to whoever wrote the probe generator.

#### Acceptance Criteria

1. WHEN a stated boundary is not probed on every side THEN the system SHALL synthesise a probe for each missing side
2. WHEN a criterion is engaged by no probe THEN the system SHALL synthesise a probe that makes the inputs it names non-default
3. THE SYSTEM SHALL vary only the input a boundary applies to, so that a synthesised probe cannot engage a different clause and be credited to this one
4. THE SYSTEM SHALL record, on every synthesised probe, the criterion and boundary that caused it
5. THE SYSTEM SHALL add synthesised probes to the run rather than replacing any, so that the search is only ever widened
6. THE SYSTEM SHALL discard a synthesised probe whose input the run already holds
7. THE SYSTEM SHALL respect a fixed budget, so that generation cannot grow the run without bound
