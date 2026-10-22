import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { pino } from 'pino';

import type { SessionInfo, TurnEvent } from '../src/events.ts';
import { createWebServer } from '../src/http/server.ts';
import { StaticAssets } from '../src/http/static.ts';
import { SessionStore } from '../src/sessions.ts';
import { CARD_HTML, startTestMcpServer } from './support/mcp-server.ts';
import { ScriptedLlm, text, toolUse } from './support/scripted-llm.ts';

const logger = pino({ level: 'silent' });

async function readEvents(response: Response): Promise<TurnEvent[]> {
  return (await response.text())
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)) as TurnEvent);
}

describe('simulator HTTP API', () => {
  let mcp: Awaited<ReturnType<typeof startTestMcpServer>>;
  let server: Server;
  let sessions: SessionStore;
  let base: string;

  before(async () => {
    mcp = await startTestMcpServer();
    const webRoot = await mkdtemp(join(tmpdir(), 'sim-web-'));
    await writeFile(join(webRoot, 'index.html'), '<!doctype html><title>sim</title>');
    const llm = new ScriptedLlm([toolUse('show_card'), text('Here is your card.')]);
    sessions = new SessionStore({ llm: llm.client, model: 'test', effort: 'low', logger });
    server = createWebServer({
      sessions,
      assets: new StaticAssets(pathToFileURL(`${webRoot}/`)),
      appConfig: { defaultServerUrl: mcp.url, provider: 'bedrock', model: 'test' },
      logger,
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  after(async () => {
    await sessions.closeAll();
    server.closeAllConnections();
    server.close();
    await mcp.close();
  });

  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('serves the web app with a strict content security policy', async () => {
    const response = await fetch(`${base}/`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  });

  it('shares the default server URL with the browser', async () => {
    const config = (await (await fetch(`${base}/api/config`)).json()) as {
      defaultServerUrl: string;
    };
    assert.equal(config.defaultServerUrl, mcp.url);
  });

  it('rejects connections to non-http URLs', async () => {
    const response = await post('/api/sessions', { serverUrl: 'file:///etc/passwd' });
    assert.equal(response.status, 400);
  });

  it('reports servers it cannot reach', async () => {
    const response = await post('/api/sessions', { serverUrl: 'http://127.0.0.1:9/mcp' });
    assert.equal(response.status, 502);
  });

  it('connects, streams a turn and serves the card in a sandboxed view', async () => {
    const connected = await post('/api/sessions', { serverUrl: mcp.url });
    assert.equal(connected.status, 201);
    const session = (await connected.json()) as SessionInfo;

    const turn = await post(`/api/sessions/${session.sessionId}/turns`, { text: 'show it' });
    assert.equal(turn.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    assert.deepEqual(
      (await readEvents(turn)).map((event) => event.type),
      ['tool_call', 'tool_result', 'card', 'reply', 'done'],
    );

    const view = await fetch(`${base}/api/sessions/${session.sessionId}/ui/show_card`);
    assert.equal(await view.text(), CARD_HTML);
    assert.match(view.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  });

  it('returns 404 for unknown sessions and answered questions', async () => {
    assert.equal((await post('/api/sessions/nope/turns', { text: 'hi' })).status, 404);
  });

  it('rejects bodies that are not JSON', async () => {
    const response = await fetch(`${base}/api/sessions`, { method: 'POST', body: 'hello' });
    assert.equal(response.status, 415);
  });
});
