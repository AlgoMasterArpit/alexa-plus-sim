import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { CallToolResult } from '@modelcontextprotocol/client';

import type { ToolResultPayload, TurnEvent } from '../src/events.ts';
import { element } from './dom.ts';

type CardEvent = Extract<TurnEvent, { type: 'card' }>;

export type ToolCaller = (
  name: string,
  args: Record<string, unknown>,
) => Promise<ToolResultPayload>;

const HOST_INFO = { name: 'alexa-plus-sim', version: '0.1.0' };

export class CardHost {
  readonly #stage: HTMLElement;
  readonly #placeholder: HTMLElement;
  #bridge: AppBridge | undefined;

  constructor(stage: HTMLElement, placeholder: HTMLElement) {
    this.#stage = stage;
    this.#placeholder = placeholder;
  }

  async show(card: CardEvent, viewUrl: string, callTool: ToolCaller): Promise<void> {
    await this.clear();

    const iframe = element('iframe');
    iframe.title = `${card.toolName} view`;
    iframe.sandbox.add('allow-scripts');
    iframe.referrerPolicy = 'no-referrer';
    this.#stage.replaceChildren(iframe);
    const view = iframe.contentWindow;
    if (!view) throw new Error('The card frame has no window');

    const bridge = new AppBridge(
      null,
      HOST_INFO,
      { serverTools: {} },
      {
        hostContext: {
          theme: 'dark',
          displayMode: 'inline',
          platform: 'web',
          locale: navigator.language,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      },
    );
    bridge.oncalltool = async (params) =>
      (await callTool(params.name, params.arguments ?? {})) as CallToolResult;
    bridge.addEventListener('initialized', () => {
      void bridge.sendToolInput({ arguments: card.toolInput });
      void bridge.sendToolResult(card.toolResult as CallToolResult);
    });
    bridge.addEventListener('sizechange', ({ height }) => {
      if (height) iframe.style.height = `${String(Math.ceil(height))}px`;
    });
    this.#bridge = bridge;

    await bridge.connect(new PostMessageTransport(view, view));
    iframe.src = viewUrl;
  }

  async clear(): Promise<void> {
    const bridge = this.#bridge;
    this.#bridge = undefined;
    if (bridge) {
      await bridge.teardownResource({}).catch(() => undefined);
      await bridge.close();
    }
    this.#stage.replaceChildren(this.#placeholder);
  }
}
