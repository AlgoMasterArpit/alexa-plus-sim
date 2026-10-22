import { getToolUiResourceUri } from '@modelcontextprotocol/ext-apps/app-bridge';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps';
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type ElicitRequest,
  type ElicitResult,
  type Tool,
} from '@modelcontextprotocol/client';

import type { ToolSummary } from './events.ts';
import { SIM_VERSION } from './version.ts';

export const PROTOCOL_MODES = ['auto', 'legacy'] as const;
export type ProtocolMode = (typeof PROTOCOL_MODES)[number];

export type ElicitationHandler = (params: ElicitRequest['params']) => Promise<ElicitResult>;

export interface ServerDetails {
  readonly name: string;
  readonly version: string;
  readonly protocolVersion: string;
  readonly instructions: string | undefined;
}

export class McpConnection {
  readonly details: ServerDetails;
  readonly tools: readonly Tool[];
  readonly #client: Client;
  readonly #uiCache = new Map<string, Promise<string | undefined>>();

  private constructor(client: Client, tools: readonly Tool[]) {
    this.#client = client;
    this.tools = tools;
    const server = client.getServerVersion();
    this.details = {
      name: server?.title ?? server?.name ?? 'MCP server',
      version: server?.version ?? 'unknown',
      protocolVersion: client.getNegotiatedProtocolVersion() ?? 'unknown',
      instructions: client.getInstructions(),
    };
  }

  static async open(options: {
    url: string;
    token: string | undefined;
    protocol: ProtocolMode;
    onElicitation: ElicitationHandler;
  }): Promise<McpConnection> {
    const client = new Client(
      { name: 'alexa-plus-sim', version: SIM_VERSION },
      {
        capabilities: {
          elicitation: { form: {} },
          extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [RESOURCE_MIME_TYPE] } },
        },
        versionNegotiation: { mode: options.protocol },
      },
    );
    client.setRequestHandler('elicitation/create', (request) =>
      options.onElicitation(request.params),
    );
    const transport = new StreamableHTTPClientTransport(new URL(options.url), {
      requestInit: options.token
        ? { headers: { Authorization: `Bearer ${options.token}` } }
        : undefined,
    });
    await client.connect(transport);
    const { tools } = await client.listTools();
    return new McpConnection(client, tools);
  }

  summaries(): ToolSummary[] {
    return this.tools.map((tool) => ({
      name: tool.name,
      title: tool.title ?? tool.annotations?.title,
      description: tool.description,
      hasUi: getToolUiResourceUri(tool) !== undefined,
    }));
  }

  findTool(name: string): Tool | undefined {
    return this.tools.find((tool) => tool.name === name);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return await this.#client.callTool({ name, arguments: args });
  }

  uiHtmlFor(tool: Tool): Promise<string | undefined> {
    const uri = getToolUiResourceUri(tool);
    if (!uri) return Promise.resolve(undefined);
    let html = this.#uiCache.get(uri);
    if (!html) {
      html = this.#readHtml(uri);
      this.#uiCache.set(uri, html);
    }
    return html;
  }

  async close(): Promise<void> {
    await this.#client.close();
  }

  async #readHtml(uri: string): Promise<string | undefined> {
    const { contents } = await this.#client.readResource({ uri });
    const html = contents.find((item) => 'text' in item && item.mimeType === RESOURCE_MIME_TYPE);
    return html && 'text' in html ? html.text : undefined;
  }
}
