# Requirements — Multi-Vendor Ensemble

## Introduction

The ensemble's value rests entirely on its members being independent readers.
Members that share a training lineage share conventions, and a shared convention
is exactly how an ambiguous specification is reported as unanimous — this
repository contains recorded evidence of that happening.

Every major vendor exposes an OpenAI-compatible endpoint, so breadth of
independence costs no new dependency.

## Requirements

### Requirement 1: Reaching other vendors

**User Story:** As an operator, I want readers from several vendors, so that agreement between them means more.

#### Acceptance Criteria

1. WHERE a vendor exposes an OpenAI-compatible endpoint the system SHALL reach it without an additional dependency
2. WHEN a member names a vendor THEN the system SHALL route that member to the provider able to serve it
3. IF a vendor is unknown THEN the system SHALL name the vendors that are known

### Requirement 2: Degrading honestly

**User Story:** As a reviewer, I want to know how independent a roster actually was, so that I can weigh its verdict.

#### Acceptance Criteria

1. IF a member's vendor has no key THEN the system SHALL drop that member rather than failing the run
2. WHEN every reachable reader comes from one vendor THEN the system SHALL report that the roster shares blind spots
3. THE SYSTEM SHALL report which vendors a roster actually used
