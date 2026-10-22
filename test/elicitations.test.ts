import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ElicitationBroker } from '../src/elicitations.ts';
import type { TurnEvent } from '../src/events.ts';

describe('ElicitationBroker', () => {
  it('cancels immediately when no turn is listening', async () => {
    const broker = new ElicitationBroker();

    assert.deepEqual(await broker.request('Sure?', {}), { action: 'cancel' });
  });

  it('emits the question and resolves with the answer', async () => {
    const broker = new ElicitationBroker();
    const events: TurnEvent[] = [];
    broker.bind((event) => events.push(event));

    const pending = broker.request('Sure?', { type: 'object' });
    const [event] = events;
    assert.equal(event?.type, 'elicitation');
    assert.equal(broker.answer(event.id, { action: 'accept', content: { confirm: true } }), true);

    assert.deepEqual(await pending, { action: 'accept', content: { confirm: true } });
  });

  it('ignores answers to unknown or already answered questions', () => {
    const broker = new ElicitationBroker();
    broker.bind(() => undefined);

    assert.equal(broker.answer('nope', { action: 'accept' }), false);
  });

  it('cancels waiting questions when the turn ends', async () => {
    const broker = new ElicitationBroker();
    broker.bind(() => undefined);

    const pending = broker.request('Sure?', {});
    broker.unbind();

    assert.deepEqual(await pending, { action: 'cancel' });
  });

  it('cancels questions nobody answers in time', async () => {
    const broker = new ElicitationBroker(10);
    broker.bind(() => undefined);

    assert.deepEqual(await broker.request('Sure?', {}), { action: 'cancel' });
  });
});
