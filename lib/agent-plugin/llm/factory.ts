/**
 * Provider factory + default selection.
 *
 * One place to construct an {@link LLMProvider} by id, and a heuristic for which
 * to default to: offline (WebLLM) when WebGPU is available, else cloud (Claude).
 */
import { AnthropicProvider, type AnthropicProviderOptions } from './anthropic';
import { OpenAIProvider, type OpenAIProviderOptions } from './openai';
import type { LLMProvider } from './types';
import { isWebGPUAvailable, WebLLMProvider, type WebLLMProviderOptions } from './webllm';

export type ProviderId = 'anthropic' | 'openai' | 'webllm';

export type ProviderOptions = AnthropicProviderOptions & OpenAIProviderOptions & WebLLMProviderOptions;

export function createProvider(id: ProviderId, options: ProviderOptions = {}): LLMProvider {
  switch (id) {
    case 'webllm':
      return new WebLLMProvider(options);
    case 'openai':
      return new OpenAIProvider(options);
    default:
      return new AnthropicProvider(options);
  }
}

/** Suggested default provider: offline when WebGPU is present, else cloud. */
export function defaultProviderId(): ProviderId {
  return isWebGPUAvailable() ? 'webllm' : 'anthropic';
}
