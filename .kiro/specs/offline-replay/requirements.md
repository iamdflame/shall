# Requirements — Offline Replay

## Introduction

A conformance report nobody can reproduce is not evidence. Before this feature,
the only thing a reader without an API key could run was the static lint, and
the headline result was something they had to take on trust.

A recording is the verbatim output of a real ensemble run, committed to the
repository and stamped with the date it was captured and the readers that
produced it. Replaying costs nothing and reproduces the original exactly. It is
never presented as a live run.

## Requirements

### Requirement 1: Replay by default

**User Story:** As someone evaluating SHALL, I want the full result without a key, so that I can judge output I am able to produce myself.

#### Acceptance Criteria

1. WHEN a committed recording exists for every reader of a program THEN the system SHALL replay it instead of calling a model
2. WHEN the system replays a recording THEN the system SHALL state that it is replaying, and when the recording was made
3. IF the operator asks for a live run THEN the system SHALL ignore recordings and call the models
4. WHERE no recording and no key exist the system SHALL name the bundled examples that do replay

### Requirement 2: Capturing a recording

**User Story:** As an author, I want to commit a run, so that others can replay exactly what I saw.

#### Acceptance Criteria

1. WHEN the operator records a program THEN the system SHALL write each reader's output and stamp it with the date and the reader that produced it
2. THE SYSTEM SHALL key a recording by the exact question the reader was asked, so that an edited specification never replays a stale answer
3. IF two programs declare the same name THEN the system SHALL keep their recordings distinct

### Requirement 3: Cost visibility

**User Story:** As a first-time user, I want to know what a run costs before it runs.

#### Acceptance Criteria

1. WHEN a dry run is requested THEN the system SHALL report how many readers are reachable and how many replay for free
2. IF a reader is unreachable THEN the system SHALL name it rather than silently shrinking the ensemble
