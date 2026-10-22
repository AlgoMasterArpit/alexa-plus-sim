import type {
  AppConfig,
  ElicitationAnswer,
  SessionInfo,
  ToolResultPayload,
  TurnEvent,
} from '../src/events.ts';

export class ApiError extends Error {
  override readonly name = 'ApiError';
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function expectOk(response: Response): Promise<Response> {
  if (response.ok) return response;
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  throw new ApiError(body.error ?? `Request failed with status ${String(response.status)}`);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return expectOk(
    await fetch(path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),
  );
}

function sessionPath(sessionId: string, suffix = ''): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}${suffix}`;
}

async function* readEventStream(response: Response): AsyncGenerator<TurnEvent> {
  if (!response.body) return;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice('data: '.length))
        .join('\n');
      if (data) yield JSON.parse(data) as TurnEvent;
      boundary = buffer.indexOf('\n\n');
    }
  }
}

export const api = {
  async config(): Promise<AppConfig> {
    return (await (await expectOk(await fetch('/api/config'))).json()) as AppConfig;
  },

  async connect(body: {
    serverUrl: string;
    token: string;
    protocol: string;
  }): Promise<SessionInfo> {
    return (await (await postJson('/api/sessions', body)).json()) as SessionInfo;
  },

  async disconnect(sessionId: string): Promise<void> {
    await fetch(sessionPath(sessionId), { method: 'DELETE' });
  },

  async *turn(sessionId: string, text: string): AsyncGenerator<TurnEvent> {
    yield* readEventStream(await postJson(sessionPath(sessionId, '/turns'), { text }));
  },

  async answer(sessionId: string, elicitationId: string, answer: ElicitationAnswer): Promise<void> {
    await postJson(
      sessionPath(sessionId, `/elicitations/${encodeURIComponent(elicitationId)}`),
      answer,
    );
  },

  async callTool(
    sessionId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResultPayload> {
    const response = await postJson(sessionPath(sessionId, '/tools/call'), {
      name,
      arguments: args,
    });
    return (await response.json()) as ToolResultPayload;
  },

  viewUrl(sessionId: string, toolName: string): string {
    return sessionPath(sessionId, `/ui/${encodeURIComponent(toolName)}`);
  },
};
