import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

// Load order mirrors extension/manifest.json content_scripts:
// ["pointer-click.js", "content.js"] — one sandbox, shared globals.
const pointerClickSource = readFileSync(new URL('../extension/pointer-click.js', import.meta.url), 'utf8');
const contentSource = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');

const VISIBLE_RECT = { top: 10, left: 10, width: 100, height: 20 };

function mockElement(tagName, { attrs = {}, rect = VISIBLE_RECT, text, children = [], ...props } = {}) {
  const node = {
    nodeType: 1,
    tagName,
    children,
    childNodes: [],
    isConnected: true,
    labels: [],
    value: '',
    type: '',
    href: '',
    disabled: false,
    checked: false,
    ...props,
    getAttribute(name) { return Object.hasOwn(attrs, name) ? attrs[name] : null; },
    getBoundingClientRect() { return rect; },
  };
  if (text !== undefined) node.childNodes.push({ nodeType: 3, textContent: text });
  node.childNodes.push(...children);
  Object.defineProperty(node, 'textContent', {
    get() { return node.childNodes.map(child => child.textContent).join(''); },
  });
  return node;
}

// body > main > [h1 "Welcome", form[aria-label=Login] > [input(email), button "Sign in"], div(0x0) > button "Ghost"]
function createPage() {
  const heading = mockElement('H1', { text: 'Welcome' });
  const email = mockElement('INPUT', { type: 'email', attrs: { 'aria-label': 'Email' } });
  const signIn = mockElement('BUTTON', { text: 'Sign in' });
  const form = mockElement('FORM', { attrs: { 'aria-label': 'Login' }, children: [email, signIn] });
  const ghost = mockElement('BUTTON', { text: 'Ghost' });
  const collapsed = mockElement('DIV', { rect: { top: 0, left: 0, width: 0, height: 0 }, children: [ghost] });
  const main = mockElement('MAIN', { children: [heading, form, collapsed] });
  const body = mockElement('BODY', { children: [main] });
  body.appendChild = () => {};
  body.removeChild = () => {};
  return { body, heading, email, signIn };
}

function createHarness() {
  const page = createPage();

  const browser = {
    runtime: { onMessage: { addListener() {} } },
    storage: {
      local: { async get() { return {}; } },
      onChanged: { addListener() {} },
    },
  };

  const mockDocument = {
    title: 'Refs Test',
    readyState: 'complete',
    head: { appendChild() {}, querySelector() { return null; } },
    body: page.body,
    documentElement: { scrollHeight: 2000 },
    importNode(node) { return node; },
    createElement() {
      return {
        style: {},
        dataset: {},
        setAttribute() {},
        getAttribute() { return null; },
        appendChild() {},
        removeChild() {},
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0 }; },
        attachShadow() {
          return { appendChild() {}, querySelector() { return null; }, querySelectorAll() { return []; } };
        },
      };
    },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
  };

  const windowObj = {
    location: { href: 'https://example.com/login', origin: 'https://example.com' },
    innerWidth: 1024,
    innerHeight: 768,
    scrollX: 0,
    scrollY: 0,
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle() { return { display: 'block', visibility: 'visible' }; },
  };
  windowObj.window = windowObj;
  windowObj.top = windowObj;

  const context = vm.createContext({
    browser,
    window: windowObj,
    document: mockDocument,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    performance: { now: () => Date.now() },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    DOMParser: class {
      parseFromString() {
        return { documentElement: { querySelector() { return null; }, querySelectorAll() { return []; } } };
      }
    },
  });

  vm.runInContext(pointerClickSource, context);
  vm.runInContext(contentSource, context);

  return { context, page };
}

const nodeLines = (text) => text.split('\n').filter(line => line.trimStart().startsWith('- '));
const refOn = (text, needle) => {
  const line = text.split('\n').find(l => l.includes(needle));
  assert.ok(line, `no line contains ${needle}:\n${text}`);
  return /\[(ref_\d+)\]/.exec(line)[1];
};

describe('element refs, text snapshot and find', () => {
  it('text snapshot lists visible elements with refs and skips hidden subtrees', () => {
    const { context } = createHarness();
    const snap = context.getAccessibilitySnapshot();
    assert.equal(snap.format, 'text');
    assert.match(snap.text, /- button "Sign in" \[ref_\d+\]/);
    assert.ok(!snap.text.includes('Ghost'), snap.text);
    assert.equal(snap.truncated, false);
  });

  it('keeps the same ref for an element across snapshots', () => {
    const { context } = createHarness();
    const first = refOn(context.getAccessibilitySnapshot().text, 'button "Sign in"');
    const second = refOn(context.getAccessibilitySnapshot().text, 'button "Sign in"');
    assert.equal(second, first);
  });

  it('filter=interactive lists only the textbox and the button', () => {
    const { context } = createHarness();
    const lines = nodeLines(context.getAccessibilitySnapshot({ filter: 'interactive' }).text);
    assert.equal(lines.length, 2, lines.join('\n'));
    assert.match(lines[0], /^- textbox "Email" \[ref_\d+\]$/);
    assert.match(lines[1], /^- button "Sign in" \[ref_\d+\]$/);
  });

  it('find matches by name and reports landmark context', () => {
    const { context } = createHarness();
    const buttonRef = refOn(context.getAccessibilitySnapshot().text, 'button "Sign in"');
    const result = context.findElements({ query: 'sign' });
    assert.equal(result.total, 1);
    assert.equal(result.truncated, false);
    const lines = result.text.split('\n');
    assert.equal(lines.length, 1, result.text);
    assert.ok(lines[0].includes(`[${buttonRef}]`), lines[0]);
    assert.ok(lines[0].includes('main > form "Login"'), lines[0]);
  });

  it('find supports regex queries', () => {
    const { context } = createHarness();
    const result = context.findElements({ query: '^Wel', regex: true });
    assert.equal(result.total, 1);
    assert.match(result.text, /^\[ref_\d+\] heading "Welcome" — main$/);
  });

  it('a ref to a detached element fails with the stale-ref message', () => {
    const { context, page } = createHarness();
    const ref = refOn(context.getAccessibilitySnapshot().text, 'button "Sign in"');
    page.signIn.isConnected = false;
    assert.throws(
      () => context.getAccessibilitySnapshot({ ref }),
      { message: `${ref} is stale or not found on the current page. Re-read the page to get fresh references.` },
    );
  });

  it('maxNodes truncates and adds the footer', () => {
    const { context } = createHarness();
    const snap = context.getAccessibilitySnapshot({ maxNodes: 2 });
    assert.equal(snap.truncated, true);
    assert.equal(nodeLines(snap.text).length, 2);
    assert.ok(snap.text.endsWith('[truncated at 2 nodes: pass ref to read a subtree or raise maxNodes]'), snap.text);
  });
});
