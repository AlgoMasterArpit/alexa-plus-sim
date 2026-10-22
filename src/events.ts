export interface ToolSummary {
  readonly name: string;
  readonly title: string | undefined;
  readonly description: string | undefined;
  readonly hasUi: boolean;
}

export interface SessionInfo {
  readonly sessionId: string;
  readonly serverName: string;
  readonly serverVersion: string;
  readonly protocolVersion: string;
  readonly tools: readonly ToolSummary[];
}

export interface AppConfig {
  readonly defaultServerUrl: string | null;
  readonly provider: string;
  readonly model: string;
}

export interface ToolResultPayload {
  readonly content: readonly unknown[];
  readonly structuredContent?: unknown;
  readonly isError?: boolean | undefined;
}

export interface ElicitationAnswer {
  readonly action: 'accept' | 'decline' | 'cancel';
  readonly content?: Record<string, string | number | boolean | string[]> | undefined;
}

export type TurnEvent =
  | {
      readonly type: 'tool_call';
      readonly name: string;
      readonly arguments: Record<string, unknown>;
    }
  | { readonly type: 'tool_result'; readonly name: string; readonly isError: boolean }
  | {
      readonly type: 'card';
      readonly toolName: string;
      readonly toolInput: Record<string, unknown>;
      readonly toolResult: ToolResultPayload;
    }
  | {
      readonly type: 'elicitation';
      readonly id: string;
      readonly message: string;
      readonly requestedSchema: unknown;
    }
  | { readonly type: 'reply'; readonly text: string }
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'done' };

export type EmitTurnEvent = (event: TurnEvent) => void;
