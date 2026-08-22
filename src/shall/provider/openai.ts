import OpenAI from 'openai';
import type {
  CompilerModel, CompletionRequest, CompletionResult, Provider,
} from './types.js';
import { ProviderError } from './types.js';

/**
 * OpenAI provider, built on the Responses API.
 *
 * Reasoning models reject `temperature`; non-reasoning models reject `reasoning`.
 * Rather than maintain a capability table that goes stale, we send what the
 * model config asks for and retry once without the offending parameter when the
 * API rejects it. The retry is narrow — only on a 400 naming the parameter.
 */
export class OpenAIProvider implements Provider {
  readonly name = 'openai';
  private client: OpenAI | null = null;

  isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  private getClient(): OpenAI {
    if (!this.client) {
      if (!this.isConfigured()) {
        throw new ProviderError(
          'OPENAI_API_KEY is not set — export it and retry',
          'auth',
          'openai',
        );
      }
      this.client = new OpenAI();
    }
    return this.client;
  }

  async listModels(): Promise<string[]> {
    const page = await this.getClient().models.list();
    return page.data.map((m) => m.id).sort();
  }

  async complete(model: CompilerModel, request: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    const base: Record<string, unknown> = {
      model: model.model,
      instructions: request.instructions,
      input: request.input,
      max_output_tokens: request.maxOutputTokens,
      store: false,
    };
    if (model.reasoning) base.reasoning = { effort: model.reasoning };
    if (model.temperature !== undefined) base.temperature = model.temperature;

    const send = async (params: Record<string, unknown>) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await this.getClient().responses.create(params as any)) as any;

    let response: { output_text?: string; usage?: { input_tokens?: number; output_tokens?: number } };
    try {
      response = await send(base);
    } catch (err) {
      const retryable = unsupportedParameter(err);
      if (retryable && retryable in base) {
        delete base[retryable];
        response = await send(base);
      } else {
        throw translate(err, model.id);
      }
    }

    const text = (response.output_text ?? '').trim();
    if (!text) {
      throw new ProviderError(`${model.id} returned an empty response`, 'unknown', model.id);
    }

    return {
      text,
      model: model.model,
      usage: {
        input: response.usage?.input_tokens ?? 0,
        output: response.usage?.output_tokens ?? 0,
      },
      ms: Date.now() - started,
    };
  }
}

/** Name of the parameter a 400 complained about, when it is one we can drop. */
function unsupportedParameter(err: unknown): string | null {
  const e = err as { status?: number; message?: string; param?: string };
  if (e?.status !== 400) return null;
  const haystack = `${e.param ?? ''} ${e.message ?? ''}`.toLowerCase();
  for (const candidate of ['temperature', 'reasoning', 'top_p']) {
    if (haystack.includes(candidate)) return candidate;
  }
  return null;
}

function translate(err: unknown, modelId: string): ProviderError {
  const e = err as { status?: number; message?: string; code?: string };
  const message = e?.message ?? String(err);

  if (e?.status === 401 || e?.status === 403) {
    return new ProviderError(`authentication failed for ${modelId}: ${message}`, 'auth', modelId);
  }
  if (e?.status === 404 || e?.code === 'model_not_found') {
    return new ProviderError(
      `model "${modelId}" is not available to this account — run \`shall models\` to see what is`,
      'not_found',
      modelId,
    );
  }
  if (e?.status === 429) {
    return new ProviderError(`rate limited on ${modelId}: ${message}`, 'rate_limit', modelId);
  }
  if (e?.status === undefined) {
    return new ProviderError(`could not reach the provider for ${modelId}: ${message}`, 'transport', modelId);
  }
  return new ProviderError(`${modelId} failed (${e.status}): ${message}`, 'unknown', modelId);
}
