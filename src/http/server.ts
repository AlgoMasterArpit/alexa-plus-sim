import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import type { AppConfig, ElicitationAnswer } from '../events.ts';
import type { Logger } from '../logger.ts';
import { PROTOCOL_MODES } from '../mcp-connection.ts';
import { SessionBusyError, type SessionStore } from '../sessions.ts';
import {
  HttpError,
  openEventStream,
  readJson,
  sendAppView,
  sendError,
  sendJson,
} from './respond.ts';
import type { StaticAssets } from './static.ts';

const connectBody = z.object({
  serverUrl: z.url({ protocol: /^https?$/, error: 'serverUrl must be an http(s) URL' }),
  token: z
    .string()
    .trim()
    .max(4096)
    .optional()
    .transform((token) => (token === '' ? undefined : token)),
  protocol: z.enum(PROTOCOL_MODES).default('auto'),
});

const turnBody = z.object({ text: z.string().trim().min(1).max(2000) });

const elicitationBody: z.ZodType<ElicitationAnswer> = z.object({
  action: z.enum(['accept', 'decline', 'cancel']),
  content: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
    .optional(),
});

const toolCallBody = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

const SESSION_ROUTE =
  /^\/api\/sessions\/([\w-]+)(?:\/(turns|tools\/call|elicitations\/([\w-]+)|ui\/([\w.-]+)))?$/;

export function describeTurnError(error: unknown): string {
  if (error instanceof SessionBusyError) return 'Still working on the last request.';
  if (error instanceof Anthropic.APIError) {
    return `The model provider rejected the request (${String(error.status ?? 'network')}): ${error.message}`;
  }
  return 'Something went wrong while handling that request. Check the simulator logs.';
}

export interface WebServerOptions {
  readonly sessions: SessionStore;
  readonly assets: StaticAssets;
  readonly appConfig: AppConfig;
  readonly logger: Logger;
}

export function createWebServer(options: WebServerOptions): Server {
  const { sessions, assets, appConfig, logger } = options;

  const requireSession = (id: string) => {
    const session = sessions.get(id);
    if (!session) throw new HttpError(404, 'Session not found. Connect again.');
    return session;
  };

  const route = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = new URL(request.url ?? '/', 'http://sim.local').pathname;
    const method = request.method ?? 'GET';

    if (method === 'GET' && assets.serve(path, response)) return;
    if (method === 'GET' && path === '/api/config') {
      sendJson(response, 200, appConfig);
      return;
    }
    if (method === 'POST' && path === '/api/sessions') {
      const body = await readJson(request, connectBody);
      try {
        const session = await sessions.open({
          url: body.serverUrl,
          token: body.token,
          protocol: body.protocol,
        });
        sendJson(response, 201, session.info());
      } catch (error) {
        logger.warn({ err: error, serverUrl: body.serverUrl }, 'could not connect to MCP server');
        throw new HttpError(
          502,
          `Could not connect to ${body.serverUrl}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return;
    }

    const match = SESSION_ROUTE.exec(path);
    if (!match) throw new HttpError(404, 'Not found');
    const [, sessionId = '', action, elicitationId, uiToolName] = match;

    if (method === 'DELETE' && !action) {
      await sessions.close(sessionId);
      response.writeHead(204).end();
      return;
    }
    if (method === 'POST' && action === 'turns') {
      const session = requireSession(sessionId);
      const { text } = await readJson(request, turnBody);
      const emit = openEventStream(response);
      try {
        await session.runTurn(text, emit);
      } catch (error) {
        logger.error({ err: error, sessionId }, 'turn failed');
        emit({ type: 'error', message: describeTurnError(error) });
      }
      emit({ type: 'done' });
      response.end();
      return;
    }
    if (method === 'POST' && action === 'tools/call') {
      const session = requireSession(sessionId);
      const body = await readJson(request, toolCallBody);
      sendJson(response, 200, await session.connection.callTool(body.name, body.arguments));
      return;
    }
    if (method === 'GET' && uiToolName) {
      const session = requireSession(sessionId);
      const tool = session.connection.findTool(uiToolName);
      const html = tool && (await session.connection.uiHtmlFor(tool));
      if (!html) throw new HttpError(404, 'This tool has no UI.');
      sendAppView(response, html);
      return;
    }
    if (method === 'POST' && elicitationId) {
      const session = requireSession(sessionId);
      const answer = await readJson(request, elicitationBody);
      if (!session.elicitations.answer(elicitationId, answer)) {
        throw new HttpError(404, 'That question is no longer waiting for an answer.');
      }
      response.writeHead(204).end();
      return;
    }
    throw new HttpError(405, 'Method not allowed');
  };

  return createServer((request, response) => {
    route(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (error instanceof HttpError) {
        sendError(response, error.status, error.message);
        return;
      }
      logger.error({ err: error }, 'unhandled request error');
      sendError(response, 500, 'Internal server error');
    });
  });
}
