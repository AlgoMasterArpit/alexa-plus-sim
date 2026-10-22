export function byId<T extends HTMLElement>(id: string, type: abstract new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`Missing #${id} in the page`);
  return element;
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { text?: string; className?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.text !== undefined) node.textContent = options.text;
  if (options.className) node.className = options.className;
  return node;
}
