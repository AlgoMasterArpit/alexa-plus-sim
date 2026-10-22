import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from '@modelcontextprotocol/ext-apps/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
  acceptedContent,
  createMcpHandler,
  inputRequired,
  inputResponse,
  McpServer,
} from '@modelcontextprotocol/server';
import { z } from 'zod';

export const CARD_URI = 'ui://test/card.html';
export const CARD_HTML = '<!doctype html><title>card</title>';

const confirmation = z.object({ confirm: z.boolean() });

function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'test-server', title: 'Test Server', version: '9.9.9' },
    { instructions: 'Always be brief.' },
  );
  server.registerTool(
    'echo',
    { description: 'Echo text back', inputSchema: z.object({ text: z.string() }) },
    ({ text }) => ({ content: [{ type: 'text', text: `echo: ${text}` }] }),
  );
  server.registerTool(
    'place_order',
    { description: 'Places an order after confirmation', inputSchema: z.object({}) },
    (_args, ctx) => {
      const answer = inputResponse(ctx.mcpReq.inputResponses, 'confirm');
      if (answer.kind === 'missing') {
        return inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({
              message: 'Place the order?',
              requestedSchema: confirmation,
            }),
          },
        });
      }
      const accepted = acceptedContent(ctx.mcpReq.inputResponses, 'confirm', confirmation);
      return {
        content: [{ type: 'text', text: accepted?.confirm ? 'order placed' : 'order cancelled' }],
      };
    },
  );
  registerAppTool(
    server,
    'show_card',
    { description: 'Shows a card', _meta: { ui: { resourceUri: CARD_URI } } },
    () => ({ content: [{ type: 'text', text: 'card shown' }], structuredContent: { ok: true } }),
  );
  registerAppResource(server, 'Card', CARD_URI, {}, () => ({
    contents: [{ uri: CARD_URI, mimeType: RESOURCE_MIME_TYPE, text: CARD_HTML }],
  }));
  return server;
}

export async function startTestMcpServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const handler = createMcpHandler(() => buildServer());
  const handle = toNodeHandler(handler);
  const server: Server = createServer((request, response) => {
    void handle(request, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}/mcp`,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await handler.close();
    },
  };
}
