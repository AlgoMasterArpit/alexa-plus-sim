import type { ElicitationAnswer } from '../src/events.ts';
import { byId, element } from './dom.ts';

interface FieldSchema {
  readonly type?: string;
  readonly title?: string;
  readonly description?: string;
  readonly enum?: readonly string[];
  readonly default?: unknown;
}

interface FormSchema {
  readonly properties?: Record<string, FieldSchema>;
  readonly required?: readonly string[];
}

type FieldValue = string | number | boolean;

export function soleBooleanField(schema: unknown): string | undefined {
  const properties = Object.entries((schema as FormSchema | undefined)?.properties ?? {});
  const [only] = properties;
  return properties.length === 1 && only?.[1].type === 'boolean' ? only[0] : undefined;
}

function fieldInput(name: string, field: FieldSchema, required: boolean): HTMLElement {
  const label = element('label', { text: field.title ?? name });
  let input: HTMLInputElement | HTMLSelectElement;
  if (field.enum) {
    input = element('select');
    input.append(
      ...field.enum.map((option) =>
        Object.assign(element('option', { text: option }), { value: option }),
      ),
    );
  } else {
    input = element('input');
    input.type =
      field.type === 'boolean'
        ? 'checkbox'
        : field.type === 'number' || field.type === 'integer'
          ? 'number'
          : 'text';
    if (field.type === 'integer') input.step = '1';
  }
  input.name = name;
  input.required = required && field.type !== 'boolean';
  if (field.default !== undefined) {
    if (input instanceof HTMLInputElement && input.type === 'checkbox')
      input.checked = field.default === true;
    else if (typeof field.default === 'string' || typeof field.default === 'number') {
      input.value = String(field.default);
    }
  }
  label.append(input);
  if (field.description)
    label.append(element('span', { text: field.description, className: 'hint' }));
  return label;
}

function readField(
  form: HTMLFormElement,
  name: string,
  field: FieldSchema,
): FieldValue | undefined {
  const input = form.elements.namedItem(name);
  if (input instanceof HTMLInputElement && input.type === 'checkbox') return input.checked;
  if (
    !(input instanceof HTMLInputElement || input instanceof HTMLSelectElement) ||
    input.value === ''
  ) {
    return undefined;
  }
  return field.type === 'number' || field.type === 'integer' ? Number(input.value) : input.value;
}

export class ConfirmDialog {
  readonly #dialog = byId('confirm-dialog', HTMLDialogElement);
  readonly #form = byId('confirm-form', HTMLFormElement);
  readonly #message = byId('confirm-message', HTMLElement);
  readonly #fields = byId('confirm-fields', HTMLElement);
  readonly #voiceHint = byId('confirm-voice-hint', HTMLElement);
  readonly #accept = byId('confirm-accept', HTMLButtonElement);
  readonly #decline = byId('confirm-decline', HTMLButtonElement);
  #settle: ((answer: ElicitationAnswer) => void) | undefined;
  #yesNoField: string | undefined;
  #properties: Record<string, FieldSchema> = {};

  constructor() {
    this.#form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.#finish(this.#collect());
    });
    this.#decline.addEventListener('click', () => {
      this.#finish({ action: 'decline' });
    });
    this.#dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.#finish({ action: 'cancel' });
    });
  }

  get isOpen(): boolean {
    return this.#dialog.open;
  }

  get isYesNo(): boolean {
    return this.#yesNoField !== undefined;
  }

  ask(message: string, schema: unknown): Promise<ElicitationAnswer> {
    this.#finish({ action: 'cancel' });
    this.#yesNoField = soleBooleanField(schema);
    this.#message.textContent = message;
    const { properties = {}, required = [] } = (schema as FormSchema | undefined) ?? {};
    this.#properties = properties;
    this.#fields.replaceChildren(
      ...(this.#yesNoField
        ? []
        : Object.entries(properties).map(([name, field]) =>
            fieldInput(name, field, required.includes(name)),
          )),
    );
    this.#voiceHint.hidden = !this.#yesNoField;
    this.#accept.textContent = this.#yesNoField ? 'Yes' : 'Submit';
    this.#decline.textContent = this.#yesNoField ? 'No' : 'Decline';
    this.#dialog.showModal();
    return new Promise((resolve) => {
      this.#settle = resolve;
    });
  }

  answerYesNo(answer: 'yes' | 'no'): void {
    if (answer === 'yes') this.#finish(this.#collect());
    else this.#finish({ action: 'decline' });
  }

  close(): void {
    this.#finish({ action: 'cancel' });
  }

  #collect(): ElicitationAnswer {
    if (this.#yesNoField) return { action: 'accept', content: { [this.#yesNoField]: true } };
    const content: Record<string, FieldValue> = {};
    for (const [name, field] of Object.entries(this.#properties)) {
      const value = readField(this.#form, name, field);
      if (value !== undefined) content[name] = value;
    }
    return { action: 'accept', content };
  }

  #finish(answer: ElicitationAnswer): void {
    const settle = this.#settle;
    this.#settle = undefined;
    if (this.#dialog.open) this.#dialog.close();
    settle?.(answer);
  }
}
