import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../../config.js';
import { AppError } from '../../lib/errors.js';

export interface AiRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export interface AiResult {
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  refused: boolean;
}

/** Provider-neutral interface so the AI layer never depends on one vendor. */
export interface AiProvider {
  readonly id: string;
  readonly configured: boolean;
  generate(req: AiRequest): Promise<AiResult>;
}

class DisabledProvider implements AiProvider {
  readonly id = 'disabled';
  readonly configured = false;
  async generate(): Promise<AiResult> {
    throw new AppError('not_configured', 'AI assistant is not configured yet');
  }
}

class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic';
  readonly configured = true;
  private client: Anthropic;
  constructor(
    apiKey: string,
    private model: string,
    private effort: 'low' | 'medium' | 'high',
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  }

  async generate(req: AiRequest): Promise<AiResult> {
    try {
      const res = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: req.maxTokens,
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: req.user }],
        output_config: { effort: this.effort },
        // Server-side fallback when a request is declined by safety classifiers.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
      if (res.stop_reason === 'refusal') {
        return { text: '', model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, refused: true };
      }
      const text = res.content
        .flatMap((b) => (b.type === 'text' ? [b.text] : []))
        .join('')
        .trim();
      return { text, model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, refused: false };
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) throw new AppError('rate_limited', 'AI is busy, please retry shortly');
      if (err instanceof Anthropic.AuthenticationError) throw new AppError('not_configured', 'AI provider credentials are invalid');
      if (err instanceof Anthropic.APIError) throw new AppError('ai_error', 'AI provider error');
      throw err;
    }
  }
}

export function createAiProvider(cfg: Config): AiProvider {
  if (cfg.AI_PROVIDER === 'anthropic' && cfg.ANTHROPIC_API_KEY) {
    return new AnthropicProvider(cfg.ANTHROPIC_API_KEY, cfg.AI_MODEL, cfg.AI_EFFORT);
  }
  return new DisabledProvider();
}
