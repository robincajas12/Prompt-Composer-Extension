import { processTemplate, getAvailableFunctions, FunctionMetadata } from './template-engine';

console.log('[Prompt Composer v2] Content script loaded.');

const SUGGESTION_BOX_ID = 'pcv2-suggestions';
const PARAM_HINT_ID = 'pcv2-param-hint';

type Point = { x: number; y: number };
type Suggestion = { name: string; description?: string };

function debounce<T extends (...args: any[]) => void>(fn: T, waitMs: number) {
  let timeoutId: number | undefined;
  return (...args: Parameters<T>) => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), waitMs);
  };
}

async function getMessages() {
  return new Promise<any>((resolve) => {
    chrome.storage.local.get(['userLanguage'], async (result) => {
      const lang = result.userLanguage || chrome.i18n.getUILanguage().split('-')[0];
      const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
      try {
        const res = await fetch(url);
        resolve(await res.json());
      } catch {
        const defUrl = chrome.runtime.getURL(`/_locales/en/messages.json`);
        const res = await fetch(defUrl);
        resolve(await res.json());
      }
    });
  });
}

function getMessage(messages: any, key: string, substitutions?: string | string[]): string {
  const msgObj = messages[key];
  if (!msgObj) return key;
  let msg: string = msgObj.message;
  if (msgObj.placeholders) {
    for (const ph in msgObj.placeholders) {
      const content = msgObj.placeholders[ph].content;
      msg = msg.replace(new RegExp(`\\$${ph}\\$`, 'g'), content);
    }
  }
  if (substitutions) {
    if (Array.isArray(substitutions)) {
      substitutions.forEach((s, i) => {
        msg = msg.replace(new RegExp(`\\$${i + 1}`, 'g'), s);
      });
    } else {
      msg = msg.replace(/\$1/g, substitutions as string);
    }
  }
  return msg;
}

class DomBox {
  el: HTMLDivElement;
  constructor(id: string, styles: string) {
    this.el = document.getElementById(id) as HTMLDivElement;
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.id = id;
      this.el.style.cssText = styles;
      document.body.appendChild(this.el);
    }
  }
  showAt(point: Point) {
    this.el.style.left = `${point.x}px`;
    this.el.style.top = `${point.y}px`;
    this.el.style.display = 'block';
    this.clampToViewport();
  }
  hide() {
    this.el.style.display = 'none';
    this.el.innerHTML = '';
  }
  clampToViewport() {
    const rect = this.el.getBoundingClientRect();
    const margin = 8;
    let left = parseInt(this.el.style.left || '0', 10);
    let top = parseInt(this.el.style.top || '0', 10);
    const maxLeft = window.scrollX + window.innerWidth - rect.width - margin;
    const maxTop = window.scrollY + window.innerHeight - rect.height - margin;
    if (left > maxLeft) left = Math.max(window.scrollX + margin, maxLeft);
    if (top > maxTop) top = Math.max(window.scrollY + margin, maxTop);
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }
  contains(node: Node) { return this.el.contains(node); }
}

class SuggestionManager {
  box: DomBox;
  items: Suggestion[] = [];
  currentIndex = -1;
  constructor() {
    this.box = new DomBox(SUGGESTION_BOX_ID, 'position:absolute;z-index:10000;background:#1f2430;border:1px solid #61afef;box-shadow:0 4px 12px rgba(0,0,0,.35);max-height:260px;overflow:auto;font:13px/1.4 \'Inter\',system-ui,Arial;color:#cfd7e3;border-radius:6px;min-width:240px;padding:4px 0;');
  }
  render(messages: any, suggestions: Suggestion[], prefix: string) {
    // Preservar selección; si no hay selección previa, seleccionar el primer elemento
    if (this.items !== suggestions) {
      if (this.currentIndex === -1 && suggestions.length > 0) {
        this.currentIndex = 0;
      } else if (suggestions.length > 0) {
        this.currentIndex = Math.max(0, Math.min(this.currentIndex, suggestions.length - 1));
      } else {
        this.currentIndex = -1;
      }
    }
    this.items = suggestions;
    const lower = prefix.toLowerCase();
    const html = suggestions.map((s, i) => {
      const name = s.name;
      const matched = name.toLowerCase().startsWith(lower) ? prefix.length : 0;
      const nameHtml = matched > 0
        ? `<span style="color:#9aa4b2;">${name.slice(0, matched)}</span><span style="color:#ffffff;">${name.slice(matched)}</span>`
        : `<span style="color:#ffffff;">${name}</span>`;
      const desc = s.description ? `<div style="margin-top:2px;color:#7f8aa3;font-size:11px;">${s.description}</div>` : '';
      const bg = i === this.currentIndex ? 'background:#61afef;color:#10131a;' : '';
      const fg = i === this.currentIndex ? 'color:#10131a;' : '';
      return `<div data-idx="${i}" role="option" style="padding:8px 12px;cursor:pointer;${bg}"><div style="${fg}">${nameHtml}${desc}</div></div>`;
    }).join('');
    if (!html) {
      const noMsg = getMessage(messages, 'noSuggestions');
      this.box.el.innerHTML = `<div style="padding:8px 12px;color:#7f8aa3;font-style:italic;">${noMsg}</div>`;
    } else {
      this.box.el.innerHTML = html;
    }
    this.attachItemHandlers();
  }
  attachItemHandlers() {
    Array.from(this.box.el.children).forEach((child) => {
      const el = child as HTMLElement;
      el.onmouseover = () => {
        const idx = Number(el.dataset.idx);
        this.highlight(idx);
      };
      el.onclick = () => {
        const idx = Number(el.dataset.idx);
        this.highlight(idx);
        this.pick();
      };
    });
  }
  showAt(point: Point) { this.box.showAt(point); }
  hide() { this.box.hide(); this.items = []; this.currentIndex = -1; }
  highlight(idx: number) {
    if (idx < 0 || idx >= this.items.length) return;
    this.currentIndex = idx;
    this.updateHighlight();
  }
  updateHighlight() {
    // Solo actualizar los estilos sin reconstruir todo el HTML
    Array.from(this.box.el.children).forEach((child, i) => {
      const el = child as HTMLElement;
      if (i === this.currentIndex) {
        el.style.backgroundColor = '#61afef';
        el.style.color = '#10131a';
      } else {
        el.style.backgroundColor = '';
        el.style.color = '';
      }
    });
    // Scroll al elemento seleccionado
    if (this.currentIndex >= 0) {
      const selectedEl = this.box.el.children[this.currentIndex] as HTMLElement;
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }
  get current(): Suggestion | null { return this.currentIndex >= 0 ? this.items[this.currentIndex] : null; }
  pick() {
    const sel = this.current;
    if (!sel) return;
    insertSuggestion(sel.name);
    this.hide();
  }
}

class ParamHintManager {
  box: DomBox;
  constructor() {
    this.box = new DomBox(PARAM_HINT_ID, 'position:absolute;z-index:10001;background:#232838;border:1px solid #61afef;box-shadow:0 4px 12px rgba(0,0,0,.35);font:12px/1.4 \'Inter\',system-ui,Arial;color:#cfd7e3;border-radius:6px;max-width:360px;padding:10px;white-space:pre-wrap;');
  }
  showAt(point: Point, meta: FunctionMetadata) {
    let content = `<b>${meta.name}</b>`;
    content += '(' + meta.parameters.map(p => {
      let part = `<span style="color:#e5c07b;">${p.name}</span>: <span style="color:#56b6c2;">${p.type}</span>`;
      if ((p as any).optional) part = `[${part}]`;
      if ((p as any).defaultValue) part += ` = <span style=\"color:#98c379;\">${(p as any).defaultValue}</span>`;
      return part;
    }).join(', ') + ')';
    const desc = (meta as any).description ? `<br><span style="color:#7f8aa3;">${(meta as any).description}</span>` : '';
    this.box.el.innerHTML = content + desc;
    this.box.showAt(point);
  }
  hide() { this.box.hide(); }
}

const suggestions = new SuggestionManager();
const paramHints = new ParamHintManager();

function getCaretPointFor(target: HTMLElement): Point | null {
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    const r = target.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.bottom + window.scrollY };
    }
  if ((target as HTMLElement).isContentEditable) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rects = range.getClientRects();
    if (rects.length > 0) {
      const r = rects[0];
      return { x: r.left + window.scrollX, y: r.bottom + window.scrollY };
    }
  }
  return null;
}

async function openSuggestionsFor(target: HTMLElement, typedPrefix: string) {
  const point = getCaretPointFor(target);
  if (!point) return;
  const all = await getAvailableFunctions();
  const prefix = typedPrefix.toLowerCase();
  let list = all
    .filter(f => prefix.length === 0 || f.name.toLowerCase().startsWith(prefix))
    .map<Suggestion>(f => ({ name: f.name, description: (f as any).description }));
  if (prefix.length === 0) list = list.slice(0, 10);
  const msgs = await getMessages();
  suggestions.render(msgs, list, typedPrefix);
  suggestions.showAt(point);
}

async function openParamHintFor(target: HTMLElement, funcName: string) {
  const point = getCaretPointFor(target);
  if (!point) return;
  const metas = await getAvailableFunctions();
  const meta = metas.find(m => m.name === funcName);
  if (meta) paramHints.showAt({ x: point.x + 24, y: point.y - 24 }, meta);
}

async function checkAndShowForTarget(target: HTMLInputElement | HTMLTextAreaElement | HTMLElement) {
  if (!target || !(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || (target as HTMLElement).isContentEditable)) {
    suggestions.hide();
    paramHints.hide();
    return;
  }
  let text = '';
  let cursor = 0;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    const t = target as HTMLInputElement;
    text = t.value;
    cursor = t.selectionStart || 0;
  } else if ((target as HTMLElement).isContentEditable) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const pre = range.cloneRange();
    pre.selectNodeContents(target);
    pre.setEnd(range.startContainer, range.startOffset);
    text = (target.textContent || '');
    cursor = pre.toString().length;
  }
  const before = text.substring(0, cursor);
  const mCall = before.match(/\$\$\s*([a-zA-Z0-9_]+)\s*\(([^)]*)$/);
  const mName = before.match(/\$\$\s*([a-zA-Z0-9_]*)$/);
  if (mCall) {
    suggestions.hide();
    await openParamHintFor(target as HTMLElement, mCall[1]);
    return;
  }
  if (mName) {
    paramHints.hide();
    await openSuggestionsFor(target as HTMLElement, mName[1]);
    return;
  }
  suggestions.hide();
  paramHints.hide();
}

async function insertSuggestion(name: string) {
  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null;
  if (!active) return;
  const matchRegex = /\$\$\s*([a-zA-Z0-9_]*)$/;
  if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') {
    const t = active as HTMLInputElement;
    const text = t.value;
    const start = t.selectionStart || 0;
    const end = t.selectionEnd || 0;
    const before = text.substring(0, start);
    const m = before.match(matchRegex);
    if (!m || m.index === undefined) return;
    const replacement = `$$${name}()`;
    const newText = before.slice(0, m.index) + replacement + text.slice(end);
    t.value = newText;
    const caret = (m.index + replacement.length - 1);
    t.setSelectionRange(caret, caret);
    return;
  }
  if ((active as HTMLElement).isContentEditable) {
    const editable = active as HTMLElement;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const full = editable.textContent || '';
    const preR = range.cloneRange();
    preR.selectNodeContents(editable);
    preR.setEnd(range.startContainer, range.startOffset);
    const start = preR.toString().length;
    const preText = full.substring(0, start);
    const m = preText.match(matchRegex);
    if (!m || m.index === undefined) return;
    const replacement = `$$${name}()`;
    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    let count = 0; let sNode: Node | null = null; let sOff = 0; let eNode: Node | null = null; let eOff = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const len = node.textContent?.length || 0;
      if (!sNode && count + len >= m.index) { sNode = node; sOff = m.index - count; }
      if (!eNode && count + len >= start) { eNode = node; eOff = start - count; break; }
      count += len;
    }
    if (sNode && eNode) {
      const r = document.createRange();
      r.setStart(sNode, sOff);
      r.setEnd(eNode, eOff);
      r.deleteContents();
      const node = document.createTextNode(replacement);
      r.insertNode(node);
      const newRange = document.createRange();
      newRange.setStart(node, replacement.length - 1);
      newRange.setEnd(node, replacement.length - 1);
      sel.removeAllRanges(); sel.addRange(newRange);
    }
  }
}

const onInput = debounce(async (e: Event) => {
  await checkAndShowForTarget(e.target as HTMLElement);
}, 60);

document.addEventListener('input', onInput);

document.addEventListener('keydown', async (e) => {
  if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
    const active = document.activeElement as HTMLElement;
    if (active) { e.preventDefault(); await checkAndShowForTarget(active); }
    return;
  }
  const suggEl = document.getElementById(SUGGESTION_BOX_ID) as HTMLElement | null;
  if (!suggEl || suggEl.style.display === 'none' || suggestions.items.length === 0) return;
  const page = 5;
  if (e.key === 'ArrowDown') { e.preventDefault(); suggestions.highlight(Math.min(suggestions.items.length - 1, suggestions.currentIndex + 1)); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); suggestions.highlight(Math.max(0, suggestions.currentIndex - 1)); return; }
  if (e.key === 'Home') { e.preventDefault(); suggestions.highlight(0); return; }
  if (e.key === 'End') { e.preventDefault(); suggestions.highlight(suggestions.items.length - 1); return; }
  if (e.key === 'PageDown') { e.preventDefault(); suggestions.highlight(Math.min(suggestions.items.length - 1, suggestions.currentIndex + page)); return; }
  if (e.key === 'PageUp') { e.preventDefault(); suggestions.highlight(Math.max(0, suggestions.currentIndex - page)); return; }
  if (e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'Tab') { e.preventDefault(); suggestions.pick(); return; }
  if (e.key === 'Escape') { suggestions.hide(); paramHints.hide(); return; }
});

['scroll', 'resize'].forEach(evt => {
  window.addEventListener(evt, () => { suggestions.hide(); paramHints.hide(); }, { passive: true });
});

document.addEventListener('click', (ev) => {
  const t = ev.target as Node;
  const sEl = document.getElementById(SUGGESTION_BOX_ID);
  const hEl = document.getElementById(PARAM_HINT_ID);
  if ((sEl && sEl.contains(t)) || (hEl && hEl.contains(t))) return;
  suggestions.hide(); paramHints.hide();
});

chrome.runtime.onMessage.addListener(async (request) => {
  if (request.action !== 'execute-prompt') return true;
  const active = document.activeElement as HTMLElement | null;
  if (!active) return true;
  const isInput = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA';
  const isCE = (active as HTMLElement).isContentEditable;
  const text = isInput ? (active as HTMLInputElement).value : isCE ? active.textContent : null;
  if (text == null) return true;
  const regex = /\$\$\s*([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
  const tasks: Promise<{ m: string; out: string }>[] = [];
  let m: RegExpExecArray | null;
  const local = new RegExp(regex.source, regex.flags);
  while ((m = local.exec(text)) !== null) {
    const full = m[0]; const fn = m[1]; const params = m[2];
    tasks.push(processTemplate(fn, params).then(out => ({ m: full, out: out || full })));
  }
  const done = await Promise.all(tasks);
  let newText = text; let changed = false;
  done.forEach(r => { if (r.out !== r.m) { newText = newText.replace(r.m, r.out); changed = true; } });
  if (changed) {
    if (isInput) (active as HTMLInputElement).value = newText;
    else if (isCE) active.textContent = newText;
  }
  return true;
});

console.log('[Prompt Composer v2] Initialized.');
