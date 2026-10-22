import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import Anthropic from '@anthropic-ai/sdk';

import type { Config } from './config.ts';

export type MessagesClient = Pick<Anthropic, 'messages'>;

const REQUEST_TIMEOUT_MS = 60_000;

export function createLlmClient(llm: Config['llm']): MessagesClient {
  const options = { timeout: REQUEST_TIMEOUT_MS, maxRetries: 2 };
  return llm.provider === 'bedrock'
    ? new AnthropicBedrockMantle({ awsRegion: llm.region, ...options })
    : new Anthropic(options);
}
