import type Anthropic from '@anthropic-ai/sdk';

import type { MessagesClient } from '../../src/llm.ts';

export type ScriptedReply = Pick<Anthropic.Message, 'stop_reason' | 'content'>;

export const text = (value: string): ScriptedReply => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: value, citations: null }],
});

export const toolUse = (name: string, input: Record<string, unknown> = {}): ScriptedReply => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id: `toolu_${name}`, name, input, caller: { type: 'direct' } }],
});

export class ScriptedLlm {
  readonly requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  readonly #replies: ScriptedReply[];

  constructor(replies: ScriptedReply[]) {
    this.#replies = [...replies];
  }

  get client(): MessagesClient {
    return {
      messages: {
        create: (params: Anthropic.MessageCreateParamsNonStreaming) => {
          this.requests.push(structuredClone(params));
          const reply = this.#replies.shift();
          if (!reply) return Promise.reject(new Error('No scripted reply left'));
          return Promise.resolve(reply);
        },
      },
    } as unknown as MessagesClient;
  }
}
