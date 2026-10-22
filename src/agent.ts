import type Anthropic from '@anthropic-ai/sdk';
import type { CallToolResult, Tool } from '@modelcontextprotocol/client';

import type { Effort } from './config.ts';
import type { EmitTurnEvent } from './events.ts';
import type { MessagesClient } from './llm.ts';
import type { Logger } from './logger.ts';
import type { McpConnection } from './mcp-connection.ts';

export const MAX_TOOL_ROUNDS = 8;

const FALLBACK_REPLY = "Sorry, I couldn't finish that. Please try again.";
const REFUSAL_REPLY = "Sorry, I can't help with that.";

export function systemPrompt(now: Date, serverInstructions: string | undefined): string {
  const lines = [
    'You are simulating Alexa+, a voice assistant on a smart display. The user speaks to you and everything you write is read aloud.',
    'Reply in one to three short, natural spoken sentences. Never use markdown, lists, emoji or URLs.',
    'Use the connected MCP server tools whenever they can answer or act, and only state facts the tools returned. If a tool fails, say so briefly and suggest what the user can do.',
    `The current date and time is ${now.toString()}.`,
  ];
  if (serverInstructions) {
    lines.push('', 'Instructions from the connected MCP server:', serverInstructions);
  }
  return lines.join('\n');
}

export function toAnthropicTool(tool: Tool): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description ?? tool.title ?? tool.name,
    input_schema: tool.inputSchema,
  };
}

export function toToolResultContent(result: CallToolResult): string {
  const text = result.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')
    .trim();
  if (text) return text;
  return result.structuredContent ? JSON.stringify(result.structuredContent) : 'Done.';
}

function replyText(content: readonly Anthropic.ContentBlock[]): string {
  return content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join(' ')
    .trim();
}

export class VoiceAgent {
  readonly #connection: McpConnection;
  readonly #llm: MessagesClient;
  readonly #model: string;
  readonly #effort: Effort;
  readonly #logger: Logger;
  readonly #clock: () => Date;
  readonly #messages: Anthropic.MessageParam[] = [];

  constructor(options: {
    connection: McpConnection;
    llm: MessagesClient;
    model: string;
    effort: Effort;
    logger: Logger;
    clock?: () => Date;
  }) {
    this.#connection = options.connection;
    this.#llm = options.llm;
    this.#model = options.model;
    this.#effort = options.effort;
    this.#logger = options.logger;
    this.#clock = options.clock ?? (() => new Date());
  }

  async runTurn(text: string, emit: EmitTurnEvent): Promise<void> {
    this.#messages.push({ role: 'user', content: text });
    const tools = this.#connection.tools.map(toAnthropicTool);
    const system = systemPrompt(this.#clock(), this.#connection.details.instructions);

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await this.#llm.messages.create({
        model: this.#model,
        max_tokens: 4_096,
        output_config: { effort: this.#effort },
        system,
        tools,
        messages: this.#messages,
      });
      this.#messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'refusal') {
        emit({ type: 'reply', text: REFUSAL_REPLY });
        return;
      }
      const toolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
        emit({ type: 'reply', text: replyText(response.content) || FALLBACK_REPLY });
        return;
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        results.push(await this.#runTool(toolUse, emit));
      }
      this.#messages.push({ role: 'user', content: results });
    }

    this.#logger.warn({ rounds: MAX_TOOL_ROUNDS }, 'turn stopped after too many tool rounds');
    emit({ type: 'reply', text: FALLBACK_REPLY });
  }

  async #runTool(
    toolUse: Anthropic.ToolUseBlock,
    emit: EmitTurnEvent,
  ): Promise<Anthropic.ToolResultBlockParam> {
    const args = (toolUse.input ?? {}) as Record<string, unknown>;
    emit({ type: 'tool_call', name: toolUse.name, arguments: args });
    try {
      const result = await this.#connection.callTool(toolUse.name, args);
      const isError = result.isError === true;
      emit({ type: 'tool_result', name: toolUse.name, isError });
      if (!isError && this.#connection.hasUi(toolUse.name)) {
        emit({ type: 'card', toolName: toolUse.name, toolInput: args, toolResult: result });
      }
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: toToolResultContent(result),
        is_error: isError,
      };
    } catch (error) {
      this.#logger.warn({ err: error, tool: toolUse.name }, 'tool call failed');
      emit({ type: 'tool_result', name: toolUse.name, isError: true });
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `The tool failed: ${error instanceof Error ? error.message : String(error)}`,
        is_error: true,
      };
    }
  }
}
