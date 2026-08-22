import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * The conformance lockfile.
 *
 * This is the mechanism that makes drift detectable rather than merely
 * assertable. At verification time we record, for every criterion, a hash of
 * the criterion text and a hash of each code region bound to it. On the next
 * run we compare. If the code hash moved and the spec hash did not, the
 * implementation changed out from under a requirement that still claims it —
 * that is drift, and it is invisible to a test suite that was never updated.
 *
 * It is a lockfile in the same sense as package-lock.json: a committed record
 * of a verified state, meaningful in diffs and reviewable in a pull request.
 */

export const LOCK_VERSION = 1;

export interface LockedCriterion {
  /** Hash of the normalized criterion text at verification time. */
  text: string;
  /** anchor key ("file:line") -> code region hash. */
  anchors: Record<string, string>;
  status: string;
  verifiedAt: string;
}

export interface Lockfile {
  version: number;
  generatedAt: string;
  criteria: Record<string, LockedCriterion>;
}

export function hashText(s: string): string {
  return createHash('sha256').update(s.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
}

export function emptyLock(): Lockfile {
  return { version: LOCK_VERSION, generatedAt: new Date().toISOString(), criteria: {} };
}

export function readLock(path: string): Lockfile | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Lockfile;
    if (parsed.version !== LOCK_VERSION) return null;
    if (!parsed.criteria || typeof parsed.criteria !== 'object') return null;
    return parsed;
  } catch {
    // A corrupt lockfile must not crash a check. Absence of a baseline means
    // "nothing to compare against", which is a safe, reportable state.
    return null;
  }
}

export function writeLock(path: string, lock: Lockfile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}
