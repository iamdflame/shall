import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CompilerModel } from './provider/types.js';

/**
 * The default ensemble.
 *
 * Members differ along two axes — model size and reasoning effort — because the
 * compiler's claim rests on its members being independent readers. Same-family
 * members share blind spots, so this roster is a floor, not an ideal: adding a
 * second provider strengthens every conclusion the oracle draws. Override with
 * `ensemble` in shall.config.json.
 */
export const DEFAULT_ENSEMBLE: CompilerModel[] = [
  { id: 'openai:gpt-4o',        provider: 'openai', model: 'gpt-4o',        label: 'gpt-4o',      temperature: 0 },
  { id: 'openai:gpt-4.1',       provider: 'openai', model: 'gpt-4.1',       label: 'gpt-4.1',     temperature: 0 },
  { id: 'openai:o4-mini',       provider: 'openai', model: 'o4-mini',       label: 'o4-mini',     reasoning: 'medium' },
  { id: 'openai:gpt-5.2',       provider: 'openai', model: 'gpt-5.2',       label: 'gpt-5.2',     reasoning: 'medium' },
  { id: 'openai:gpt-5.6-luna',  provider: 'openai', model: 'gpt-5.6-luna',  label: 'gpt-5.6-luna' },
  { id: 'openai:gpt-5.6-terra', provider: 'openai', model: 'gpt-5.6-terra', label: 'gpt-5.6-terra' },
];

export interface ShallConfig {
  ensemble: CompilerModel[];
  /** Directory for build artifacts, candidates and reports. */
  buildDir: string;
  /** Generated probe inputs per program. More probes find more ambiguity. */
  probeCount: number;
  /** Max tokens a single compiler member may emit. */
  maxOutputTokens: number;
  /** Milliseconds a candidate may run on one probe before being killed. */
  executionTimeoutMs: number;
  /**
   * Members that must agree before a build is accepted. Below this, the build
   * is a compile error. Never 1 — a single reader cannot detect ambiguity.
   */
  quorum: number;
}

export const DEFAULT_CONFIG: ShallConfig = {
  ensemble: DEFAULT_ENSEMBLE,
  buildDir: '.shall',
  probeCount: 96,
  maxOutputTokens: 8000,
  executionTimeoutMs: 1000,
  quorum: 2,
};

export function loadShallConfig(root: string): ShallConfig {
  const path = join(root, 'shall.config.json');
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ShallConfig>;
    const merged = { ...DEFAULT_CONFIG, ...raw };
    if (merged.quorum < 2) {
      throw new Error('quorum must be at least 2 — one reader cannot detect ambiguity');
    }
    if (merged.ensemble.length < 2) {
      throw new Error('the ensemble needs at least 2 members — one reader cannot detect ambiguity');
    }
    return merged;
  } catch (err) {
    throw new Error(`shall.config.json: ${(err as Error).message}`);
  }
}
