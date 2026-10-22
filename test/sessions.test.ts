import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { pino } from 'pino';

import type { TurnEvent } from '../src/events.ts';
import type { ProtocolMode } from '../src/mcp-connection.ts';
import { SessionStore } from '../src/sessions.ts';
import { CARD_HTML, startTestMcpServer } from './support/mcp-server.ts';
import { ScriptedLlm, text, toolUse, type ScriptedReply } from './support/scripted-llm.ts';

const logger = pino({ level: 'silent' });

describe('voice sessions against a live MCP server', () => {
  let server: Awaited<ReturnType<typeof startTestMcpServer>>;

  before(async () => {
    server = await startTestMcpServer();
  });

  after(async () => {
    await server.close();
  });

  async function openSession(replies: ScriptedReply[], protocol: ProtocolMode = 'auto') {
    const llm = new ScriptedLlm(replies);
    const store = new SessionStore({ llm: llm.client, model: 'test-model', effort: 'low', logger });
    const session = await store.open({ url: server.url, token: undefined, protocol });
    return { llm, store, session };
  }

  it('describes the connected server and its tools', async () => {
    const { store, session } = await openSession([]);

    const info = session.info();
    assert.equal(info.serverName, 'Test Server');
    assert.equal(info.serverVersion, '9.9.9');
    assert.deepEqual(info.tools.map((tool) => `${tool.name}:${String(tool.hasUi)}`).toSorted(), [
      'echo:false',
      'place_order:false',
      'show_card:true',
    ]);
    await store.closeAll();
  });

  it('runs a tool and speaks the final answer', async () => {
    const { llm, store, session } = await openSession([
      toolUse('echo', { text: 'hello' }),
      text('The server said hello.'),
    ]);
    const events: TurnEvent[] = [];

    await session.runTurn('say hello', (event) => events.push(event));

    assert.deepEqual(
      events.map((event) => event.type),
      ['tool_call', 'tool_result', 'reply'],
    );
    assert.deepEqual(events.at(-1), { type: 'reply', text: 'The server said hello.' });
    assert.match(llm.requests[0]?.system as string, /Always be brief\./);
    const toolResult = llm.requests[1]?.messages.at(-1);
    assert.deepEqual(toolResult?.content, [
      { type: 'tool_result', tool_use_id: 'toolu_echo', content: 'echo: hello', is_error: false },
    ]);
    await store.closeAll();
  });

  it('relays confirmation prompts and returns the answer to the server', async () => {
    const { llm, store, session } = await openSession([toolUse('place_order'), text('Done.')]);
    const events: TurnEvent[] = [];

    await session.runTurn('order it', (event) => {
      events.push(event);
      if (event.type === 'elicitation') {
        session.elicitations.answer(event.id, { action: 'accept', content: { confirm: true } });
      }
    });

    const prompt = events.find((event) => event.type === 'elicitation');
    assert.equal(prompt?.message, 'Place the order?');
    const toolResult = llm.requests[1]?.messages.at(-1)?.content as { content: string }[];
    assert.equal(toolResult[0]?.content, 'order placed');
    await store.closeAll();
  });

  it('sends a declined confirmation back as a cancellation', async () => {
    const { llm, store, session } = await openSession([toolUse('place_order'), text('Okay.')]);

    await session.runTurn('order it', (event) => {
      if (event.type === 'elicitation') {
        session.elicitations.answer(event.id, { action: 'decline' });
      }
    });

    const toolResult = llm.requests[1]?.messages.at(-1)?.content as { content: string }[];
    assert.equal(toolResult[0]?.content, 'order cancelled');
    await store.closeAll();
  });

  it('streams MCP Apps cards for tools that declare a UI', async () => {
    const { store, session } = await openSession([toolUse('show_card'), text('Here it is.')]);
    const events: TurnEvent[] = [];

    await session.runTurn('show me', (event) => events.push(event));

    const card = events.find((event) => event.type === 'card');
    assert.equal(card?.html, CARD_HTML);
    assert.deepEqual(card.toolResult.structuredContent, { ok: true });
    await store.closeAll();
  });

  it('reports unknown tools back to the model instead of crashing', async () => {
    const { llm, store, session } = await openSession([toolUse('missing_tool'), text('Sorry.')]);

    await session.runTurn('do something', () => undefined);

    const toolResult = llm.requests[1]?.messages.at(-1)?.content as { is_error: boolean }[];
    assert.equal(toolResult[0]?.is_error, true);
    await store.closeAll();
  });

  it('falls back to an apology when the model refuses', async () => {
    const { store, session } = await openSession([{ stop_reason: 'refusal', content: [] }]);
    const events: TurnEvent[] = [];

    await session.runTurn('anything', (event) => events.push(event));

    assert.deepEqual(events, [{ type: 'reply', text: "Sorry, I can't help with that." }]);
    await store.closeAll();
  });
});
