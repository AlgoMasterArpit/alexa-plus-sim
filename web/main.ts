import type { SessionInfo, TurnEvent } from '../src/events.ts';
import { api, ApiError } from './api.ts';
import { CardHost } from './card-host.ts';
import { ConfirmDialog } from './confirm.ts';
import { byId, element } from './dom.ts';
import { canListen, interpretYesNo, Listener, speak, stopSpeaking } from './speech.ts';

type RingState = 'idle' | 'listening' | 'thinking' | 'speaking';

const ui = {
  status: byId('status', HTMLElement),
  connectPanel: byId('connect-panel', HTMLElement),
  connectForm: byId('connect-form', HTMLFormElement),
  connectButton: byId('connect-button', HTMLButtonElement),
  connectError: byId('connect-error', HTMLElement),
  serverUrl: byId('server-url', HTMLInputElement),
  serverToken: byId('server-token', HTMLInputElement),
  serverProtocol: byId('server-protocol', HTMLSelectElement),
  device: byId('device', HTMLElement),
  conversation: byId('conversation', HTMLElement),
  ring: byId('ring', HTMLElement),
  turnForm: byId('turn-form', HTMLFormElement),
  turnText: byId('turn-text', HTMLInputElement),
  micButton: byId('mic-button', HTMLButtonElement),
  disconnectButton: byId('disconnect-button', HTMLButtonElement),
  serverPanel: byId('server-panel', HTMLElement),
  serverName: byId('server-name', HTMLElement),
  serverProtocolVersion: byId('server-protocol-version', HTMLElement),
  serverModel: byId('server-model', HTMLElement),
  toolList: byId('tool-list', HTMLElement),
  activity: byId('activity', HTMLElement),
};

const listener = new Listener();
const confirmDialog = new ConfirmDialog();
const cards = new CardHost(byId('stage', HTMLElement), byId('stage-hint', HTMLElement));

let session: SessionInfo | undefined;
let busy = false;
let interimBubble: HTMLElement | undefined;

function setRing(state: RingState): void {
  ui.ring.dataset.state = state;
}

function addBubble(role: 'user' | 'assistant' | 'error', text: string): void {
  ui.conversation.append(element('div', { text, className: `bubble ${role}` }));
  ui.conversation.scrollTop = ui.conversation.scrollHeight;
}

function showInterim(text: string): void {
  interimBubble ??= element('div', { className: 'bubble user interim' });
  interimBubble.textContent = text;
  if (!interimBubble.isConnected) ui.conversation.append(interimBubble);
  ui.conversation.scrollTop = ui.conversation.scrollHeight;
}

function clearInterim(): void {
  interimBubble?.remove();
  interimBubble = undefined;
}

function logActivity(text: string, failed = false): void {
  const item = element('li', { text: `${new Date().toLocaleTimeString()} ${text}` });
  if (failed) item.classList.add('failed');
  ui.activity.prepend(item);
}

async function say(text: string): Promise<void> {
  setRing('speaking');
  await speak(text);
  setRing('idle');
}

function listenOnce(onFinal: (text: string) => void): void {
  stopSpeaking();
  ui.micButton.setAttribute('aria-pressed', 'true');
  setRing('listening');
  listener.start({
    onInterim: showInterim,
    onFinal: (text) => {
      clearInterim();
      onFinal(text);
    },
    onEnd: () => {
      clearInterim();
      ui.micButton.setAttribute('aria-pressed', 'false');
      if (ui.ring.dataset.state === 'listening') setRing('idle');
    },
    onError: (message) => {
      addBubble('error', message);
    },
  });
}

async function handleElicitation(
  event: Extract<TurnEvent, { type: 'elicitation' }>,
): Promise<void> {
  if (!session) return;
  logActivity(`server asks: ${event.message}`);
  const answer = confirmDialog.ask(event.message, event.requestedSchema);
  if (confirmDialog.isYesNo) {
    await say(event.message);
    if (confirmDialog.isOpen && canListen) {
      listenOnce((text) => {
        addBubble('user', text);
        const decision = interpretYesNo(text);
        if (decision) confirmDialog.answerYesNo(decision);
      });
    }
  }
  const result = await answer;
  listener.cancel();
  logActivity(`answered: ${result.action}`);
  await api.answer(session.sessionId, event.id, result);
  setRing('thinking');
}

async function handleEvent(event: TurnEvent): Promise<void> {
  if (!session) return;
  switch (event.type) {
    case 'tool_call':
      logActivity(`â†’ ${event.name} ${JSON.stringify(event.arguments)}`);
      return;
    case 'tool_result':
      logActivity(`â† ${event.name}${event.isError ? ' failed' : ''}`, event.isError);
      return;
    case 'card': {
      const { sessionId } = session;
      await cards.show(event, api.viewUrl(sessionId, event.toolName), (name, args) =>
        api.callTool(sessionId, name, args),
      );
      return;
    }
    case 'elicitation':
      await handleElicitation(event);
      return;
    case 'reply':
      addBubble('assistant', event.text);
      await say(event.text);
      return;
    case 'error':
      addBubble('error', event.message);
      return;
    case 'done':
      return;
  }
}

async function sendTurn(text: string): Promise<void> {
  const message = text.trim();
  if (!session || busy || !message) return;
  busy = true;
  addBubble('user', message);
  setRing('thinking');
  try {
    const pending: Promise<void>[] = [];
    for await (const event of api.turn(session.sessionId, message)) {
      if (event.type === 'elicitation') pending.push(handleEvent(event));
      else await handleEvent(event);
    }
    await Promise.all(pending);
  } catch (error) {
    addBubble(
      'error',
      error instanceof ApiError ? error.message : 'Lost the connection to the simulator.',
    );
  } finally {
    confirmDialog.close();
    busy = false;
    if (ui.ring.dataset.state === 'thinking') setRing('idle');
  }
}

function renderSession(info: SessionInfo, model: string): void {
  ui.status.textContent = `Connected to ${info.serverName} Â· MCP ${info.protocolVersion}`;
  ui.serverName.textContent = `${info.serverName} ${info.serverVersion}`;
  ui.serverProtocolVersion.textContent = info.protocolVersion;
  ui.serverModel.textContent = model;
  ui.toolList.replaceChildren(
    ...info.tools.map((tool) => {
      const item = element('li', { text: tool.name });
      item.title = tool.description ?? '';
      if (tool.hasUi) item.append(element('span', { text: 'UI', className: 'ui-badge' }));
      return item;
    }),
  );
  ui.connectPanel.hidden = true;
  ui.device.hidden = false;
  ui.serverPanel.hidden = false;
  ui.micButton.disabled = !canListen;
  ui.turnText.focus();
}

async function connect(model: string): Promise<void> {
  ui.connectButton.disabled = true;
  ui.connectError.hidden = true;
  try {
    session = await api.connect({
      serverUrl: ui.serverUrl.value,
      token: ui.serverToken.value,
      protocol: ui.serverProtocol.value,
    });
    renderSession(session, model);
  } catch (error) {
    ui.connectError.textContent = error instanceof Error ? error.message : String(error);
    ui.connectError.hidden = false;
  } finally {
    ui.connectButton.disabled = false;
  }
}

async function disconnect(): Promise<void> {
  const current = session;
  session = undefined;
  listener.cancel();
  stopSpeaking();
  await cards.clear();
  ui.conversation.replaceChildren();
  ui.activity.replaceChildren();
  ui.device.hidden = true;
  ui.serverPanel.hidden = true;
  ui.connectPanel.hidden = false;
  ui.status.textContent = 'Not connected';
  if (current) await api.disconnect(current.sessionId);
}

async function start(): Promise<void> {
  const config = await api.config();
  if (config.defaultServerUrl) ui.serverUrl.value = config.defaultServerUrl;

  ui.connectForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void connect(`${config.model} on ${config.provider}`);
  });
  ui.disconnectButton.addEventListener('click', () => void disconnect());
  ui.turnForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = ui.turnText.value;
    ui.turnText.value = '';
    void sendTurn(text);
  });
  ui.micButton.addEventListener('click', () => {
    if (listener.active) listener.stop();
    else if (!busy) listenOnce((text) => void sendTurn(text));
  });
  document.addEventListener('keydown', (event) => {
    const typing = document.activeElement instanceof HTMLInputElement;
    if (event.code === 'Space' && !typing && !ui.device.hidden && !busy && !listener.active) {
      event.preventDefault();
      listenOnce((text) => void sendTurn(text));
    }
  });
  setRing('idle');
}

void start();
