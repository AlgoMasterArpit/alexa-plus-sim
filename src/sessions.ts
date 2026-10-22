import { randomUUID } from 'node:crypto';

import { VoiceAgent } from './agent.ts';
import type { Effort } from './config.ts';
import { ElicitationBroker } from './elicitations.ts';
import type { EmitTurnEvent, SessionInfo } from './events.ts';
import type { MessagesClient } from './llm.ts';
import type { Logger } from './logger.ts';
import { McpConnection, type ProtocolMode } from './mcp-connection.ts';

export const SESSION_IDLE_MS = 30 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

export class SessionBusyError extends Error {
  override readonly name = 'SessionBusyError';
}

export class Session {
  readonly id = randomUUID();
  readonly connection: McpConnection;
  readonly elicitations: ElicitationBroker;
  readonly #agent: VoiceAgent;
  #busy = false;
  #lastActive = Date.now();

  constructor(connection: McpConnection, agent: VoiceAgent, elicitations: ElicitationBroker) {
    this.connection = connection;
    this.#agent = agent;
    this.elicitations = elicitations;
  }

  get idleFor(): number {
    return this.#busy ? 0 : Date.now() - this.#lastActive;
  }

  async runTurn(text: string, emit: EmitTurnEvent): Promise<void> {
    if (this.#busy) throw new SessionBusyError('A turn is already running for this session');
    this.#busy = true;
    this.elicitations.bind(emit);
    try {
      await this.#agent.runTurn(text, emit);
    } finally {
      this.elicitations.unbind();
      this.#busy = false;
      this.#lastActive = Date.now();
    }
  }

  touch(): void {
    this.#lastActive = Date.now();
  }

  info(): SessionInfo {
    const { details } = this.connection;
    return {
      sessionId: this.id,
      serverName: details.name,
      serverVersion: details.version,
      protocolVersion: details.protocolVersion,
      tools: this.connection.summaries(),
    };
  }

  async close(): Promise<void> {
    this.elicitations.unbind();
    await this.connection.close();
  }
}

export class SessionStore {
  readonly #sessions = new Map<string, Session>();
  readonly #llm: MessagesClient;
  readonly #model: string;
  readonly #effort: Effort;
  readonly #logger: Logger;
  readonly #sweeper: NodeJS.Timeout;

  constructor(options: { llm: MessagesClient; model: string; effort: Effort; logger: Logger }) {
    this.#llm = options.llm;
    this.#model = options.model;
    this.#effort = options.effort;
    this.#logger = options.logger;
    this.#sweeper = setInterval(() => void this.#sweep(), SWEEP_INTERVAL_MS);
    this.#sweeper.unref();
  }

  async open(options: {
    url: string;
    token: string | undefined;
    protocol: ProtocolMode;
  }): Promise<Session> {
    const elicitations = new ElicitationBroker();
    const connection = await McpConnection.open({
      ...options,
      onElicitation: (params) =>
        elicitations
          .request(params.message, 'requestedSchema' in params ? params.requestedSchema : undefined)
          .then((answer) => ({ ...answer })),
    });
    const agent = new VoiceAgent({
      connection,
      llm: this.#llm,
      model: this.#model,
      effort: this.#effort,
      logger: this.#logger,
    });
    const session = new Session(connection, agent, elicitations);
    this.#sessions.set(session.id, session);
    this.#logger.info(
      {
        sessionId: session.id,
        server: connection.details.name,
        protocol: connection.details.protocolVersion,
      },
      'connected to MCP server',
    );
    return session;
  }

  get(id: string): Session | undefined {
    const session = this.#sessions.get(id);
    session?.touch();
    return session;
  }

  async close(id: string): Promise<boolean> {
    const session = this.#sessions.get(id);
    if (!session) return false;
    this.#sessions.delete(id);
    await session.close();
    return true;
  }

  async closeAll(): Promise<void> {
    clearInterval(this.#sweeper);
    await Promise.allSettled([...this.#sessions.keys()].map((id) => this.close(id)));
  }

  async #sweep(): Promise<void> {
    const idle = [...this.#sessions.values()].filter(
      (session) => session.idleFor > SESSION_IDLE_MS,
    );
    await Promise.allSettled(idle.map((session) => this.close(session.id)));
  }
}
