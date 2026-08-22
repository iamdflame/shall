import type { CompilerModel, Provider } from './types.js';
import { ProviderError } from './types.js';
import { OpenAIProvider } from './openai.js';
import { OpenAICompatibleProvider, VENDORS } from './compatible.js';

/**
 * Routes each ensemble member to the provider that can reach it.
 *
 * A member's `provider` field names a vendor; anything other than `openai` is
 * served through the compatible endpoint. Members whose vendor has no key
 * present are dropped from the roster rather than failing the run, so a
 * cross-vendor ensemble degrades to whatever is actually configured.
 */
export class ProviderRegistry implements Provider {
  readonly name = 'registry';
  private readonly providers = new Map<string, Provider>();

  constructor() {
    this.providers.set('openai', new OpenAIProvider());
    for (const [vendor, { baseURL, keyVar }] of Object.entries(VENDORS)) {
      this.providers.set(vendor, new OpenAICompatibleProvider(vendor, baseURL, keyVar));
    }
  }

  providerFor(vendor: string): Provider {
    const provider = this.providers.get(vendor);
    // @shall multi-vendor-ensemble/1.3
    if (!provider) {
      throw new ProviderError(
        `unknown vendor "${vendor}" - known vendors: openai, ${Object.keys(VENDORS).join(', ')}`,
        'not_found',
        vendor,
      );
    }
    return provider;
  }

  isConfigured(): boolean {
    return [...this.providers.values()].some((p) => p.isConfigured());
  }

  /** Vendors with a usable key right now. */
  configuredVendors(): string[] {
    return [...this.providers.entries()].filter(([, p]) => p.isConfigured()).map(([name]) => name);
  }

  async listModels(): Promise<string[]> {
    const all = await Promise.all(
      [...this.providers.entries()]
        .filter(([, p]) => p.isConfigured())
        .map(async ([vendor, p]) => (await p.listModels()).map((m) => `${vendor}:${m}`)),
    );
    return all.flat().sort();
  }

  // @shall multi-vendor-ensemble/1.2
  async complete(model: CompilerModel, request: Parameters<Provider['complete']>[1]) {
    return this.providerFor(model.provider).complete(model, request);
  }
}

/**
 * Drop members whose vendor has no key, and report what independence the
 * surviving roster actually has.
 *
 * A single-vendor ensemble is the sharpest known weakness of this design:
 * members that share a training lineage share conventions, and a shared
 * convention is exactly how an ambiguous specification gets reported as
 * unanimous. The roster is therefore reported honestly rather than silently.
 */
// @shall multi-vendor-ensemble/2.1
// @shall multi-vendor-ensemble/2.3
export function resolveRoster(
  ensemble: CompilerModel[],
  registry: ProviderRegistry,
): { usable: CompilerModel[]; dropped: CompilerModel[]; vendors: string[]; singleVendor: boolean } {
  const configured = new Set(registry.configuredVendors());
  const usable = ensemble.filter((m) => configured.has(m.provider));
  const dropped = ensemble.filter((m) => !configured.has(m.provider));
  const vendors = [...new Set(usable.map((m) => m.provider))].sort();
  return { usable, dropped, vendors, singleVendor: vendors.length <= 1 };
}
