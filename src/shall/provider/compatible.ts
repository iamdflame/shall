import OpenAI from 'openai';
import type { CompilerModel, CompletionRequest, CompletionResult, Provider } from './types.js';
import { ProviderError } from './types.js';

/**
 * A provider for any vendor exposing an OpenAI-compatible endpoint.
 *
 * The ensemble's entire value rests on its members being independent readers,
 * and the sharpest known weakness of this project is that they currently all
 * come from one vendor. Same-vendor readers share training lineage, and
 * therefore share conventions - which is exactly how a specification gets
 * reported as unambiguous when it is not.
 *
 * Anthropic, Google, Groq, DeepSeek, Mistral, OpenRouter, Together and a local
 * Ollama all speak the OpenAI wire format, so one client class reaches all of
 * them and the one-runtime-dependency rule survives intact.
 *
 * The chat-completions endpoint is used rather than Responses, because that is
 * the surface compatible vendors actually implement.
 */
// @shall multi-vendor-ensemble/1.1
export class OpenAICompatibleProvider implements Provider {
  private client: OpenAI | null = null;

  constructor(
    readonly name: string,
    private readonly baseURL: string,
    private readonly keyVar: string,
  ) {}

  isConfigured(): boolean {
    return Boolean(process.env[this.keyVar]);
  }

  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = process.env[this.keyVar];
      if (!apiKey) {
        throw new ProviderError(`${this.keyVar} is not set`, 'auth', this.name);
      }
      this.client = new OpenAI({ apiKey, baseURL: this.baseURL });
    }
    return this.client;
  }

  async listModels(): Promise<string[]> {
    try {
      const page = await this.getClient().models.list();
      return page.data.map((m) => m.id).sort();
    } catch {
      // Several compatible vendors do not implement /models. That is not a
      // reason to fail; it only means the roster cannot be validated up front.
      return [];
    }
  }

  async complete(model: CompilerModel, request: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    const params: Record<string, unknown> = {
      model: model.model,
      max_tokens: request.maxOutputTokens,
      messages: [
        { role: 'system', content: request.instructions },
        { role: 'user', content: request.input },
      ],
    };
    if (model.temperature !== undefined) params.temperature = model.temperature;

    let completion: { choices?: { message?: { content?: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      completion = (await this.getClient().chat.completions.create(params as any)) as any;
    } catch (err) {
      const e = err as { status?: number; message?: string };
      if (e?.status === 400 && 'temperature' in params) {
        delete params.temperature;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        completion = (await this.getClient().chat.completions.create(params as any)) as any;
      } else {
        throw translate(err, `${this.name}:${model.model}`);
      }
    }

    const text = (completion.choices?.[0]?.message?.content ?? '').trim();
    if (!text) {
      throw new ProviderError(`${model.id} returned an empty response`, 'unknown', model.id);
    }

    return {
      text,
      model: model.model,
      usage: {
        input: completion.usage?.prompt_tokens ?? 0,
        output: completion.usage?.completion_tokens ?? 0,
      },
      ms: Date.now() - started,
    };
  }
}

function translate(err: unknown, modelId: string): ProviderError {
  const e = err as { status?: number; message?: string };
  const message = e?.message ?? String(err);
  if (e?.status === 401 || e?.status === 403) {
    return new ProviderError(`authentication failed for ${modelId}: ${message}`, 'auth', modelId);
  }
  if (e?.status === 404) {
    return new ProviderError(`model "${modelId}" is not available on this endpoint`, 'not_found', modelId);
  }
  if (e?.status === 429) {
    return new ProviderError(`rate limited on ${modelId}`, 'rate_limit', modelId);
  }
  if (e?.status === undefined) {
    return new ProviderError(`could not reach ${modelId}: ${message}`, 'transport', modelId);
  }
  return new ProviderError(`${modelId} failed (${e.status}): ${message}`, 'unknown', modelId);
}

/**
 * Vendors reachable through the compatible endpoint, and the environment
 * variable each one reads. A vendor with no key present is simply absent from
 * the ensemble; nothing needs configuring to turn one off.
 */
export const VENDORS: Record<string, { baseURL: string; keyVar: string }> = {
  anthropic:  { baseURL: 'https://api.anthropic.com/v1/',            keyVar: 'ANTHROPIC_API_KEY' },
  google:     { baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', keyVar: 'GEMINI_API_KEY' },
  groq:       { baseURL: 'https://api.groq.com/openai/v1',           keyVar: 'GROQ_API_KEY' },
  deepseek:   { baseURL: 'https://api.deepseek.com',                 keyVar: 'DEEPSEEK_API_KEY' },
  mistral:    { baseURL: 'https://api.mistral.ai/v1',                keyVar: 'MISTRAL_API_KEY' },
  openrouter: { baseURL: 'https://openrouter.ai/api/v1',             keyVar: 'OPENROUTER_API_KEY' },
  together:   { baseURL: 'https://api.together.xyz/v1',              keyVar: 'TOGETHER_API_KEY' },
  ollama:     { baseURL: 'http://localhost:11434/v1',                keyVar: 'OLLAMA_HOST' },
};
