/**
 * Provider abstraction.
 *
 * SHALL's compiler is an ensemble, and the ensemble's value depends entirely on
 * its members being genuinely independent readers of the same English. The
 * abstraction is therefore narrow on purpose: a member is anything that can turn
 * (instructions, input) into text. Adding a second provider must never require
 * touching the compiler, the oracle, or the reporter.
 */

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export interface CompilerModel {
  /** Stable identity used in reports and cache keys, e.g. "openai:gpt-5/high". */
  id: string;
  provider: string;
  model: string;
  /** Short human label for report columns. */
  label: string;
  reasoning?: ReasoningEffort;
  /**
   * Sampling temperature, where the model accepts it. A second axis of
   * divergence: two runs of the same model at different temperatures read an
   * ambiguous clause differently more often than one run does.
   */
  temperature?: number;
}

export interface CompletionRequest {
  instructions: string;
  input: string;
  maxOutputTokens: number;
}

export interface CompletionResult {
  text: string;
  model: string;
  usage: { input: number; output: number };
  ms: number;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'not_found' | 'rate_limit' | 'transport' | 'unknown',
    readonly modelId: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface Provider {
  readonly name: string;
  /** False when credentials are absent; the CLI reports this rather than throwing. */
  isConfigured(): boolean;
  complete(model: CompilerModel, request: CompletionRequest): Promise<CompletionResult>;
  /** Model ids the account can actually reach, for `shall models`. */
  listModels(): Promise<string[]>;
}
