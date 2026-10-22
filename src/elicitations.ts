import { randomUUID } from 'node:crypto';

import type { ElicitationAnswer, EmitTurnEvent } from './events.ts';

export const ELICITATION_TIMEOUT_MS = 120_000;

interface Pending {
  readonly resolve: (answer: ElicitationAnswer) => void;
  readonly timer: NodeJS.Timeout;
}

export class ElicitationBroker {
  readonly #pending = new Map<string, Pending>();
  readonly #timeoutMs: number;
  #emit: EmitTurnEvent | undefined;

  constructor(timeoutMs = ELICITATION_TIMEOUT_MS) {
    this.#timeoutMs = timeoutMs;
  }

  bind(emit: EmitTurnEvent): void {
    this.#emit = emit;
  }

  unbind(): void {
    this.#emit = undefined;
    for (const id of [...this.#pending.keys()]) this.#settle(id, { action: 'cancel' });
  }

  request(message: string, requestedSchema: unknown): Promise<ElicitationAnswer> {
    const emit = this.#emit;
    if (!emit) return Promise.resolve({ action: 'cancel' });
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#settle(id, { action: 'cancel' });
      }, this.#timeoutMs);
      this.#pending.set(id, { resolve, timer });
      emit({ type: 'elicitation', id, message, requestedSchema });
    });
  }

  answer(id: string, answer: ElicitationAnswer): boolean {
    return this.#settle(id, answer);
  }

  #settle(id: string, answer: ElicitationAnswer): boolean {
    const pending = this.#pending.get(id);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.#pending.delete(id);
    pending.resolve(answer);
    return true;
  }
}
