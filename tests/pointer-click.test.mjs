import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const source = readFileSync(new URL('../extension/pointer-click.js', import.meta.url), 'utf8');

class FakeMouseEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.init = init;
    this.isTrusted = false;
    this.defaultPrevented = false;
  }
  preventDefault() {
    if (this.init.cancelable) this.defaultPrevented = true;
  }
}
class FakePointerEvent extends FakeMouseEvent {}

function makeElement({ tagName = 'DIV', id = '', className = '', rect, parent = null } = {}) {
  const el = {
    tagName,
    id,
    className,
    parent,
    log: null,
    listeners: {},
    clicked: 0,
    focused: 0,
    focusable: false,
    getBoundingClientRect: () => rect ?? { left: 100, top: 200, width: 40, height: 20 },
    contains(other) {
      for (let n = other; n; n = n.parent) if (n === el) return true;
      return false;
    },
    closest() {
      for (let n = el; n; n = n.parent) if (n.focusable) return n;
      return null;
    },
    focus() { el.focused += 1; el.log?.push('focus'); },
    click() { el.clicked += 1; },
    addEventListener(type, fn) { (el.listeners[type] ??= []).push(fn); },
    dispatchEvent(event) {
      event.target = el;
      el.log?.push(event.type);
      // bubbling events reach listeners on ancestors too
      for (let n = el; n; n = event.init.bubbles ? n.parent : null) {
        for (const fn of n.listeners[event.type] ?? []) fn(event);
      }
      return !event.defaultPrevented;
    },
  };
  return el;
}

function harness({ hit } = {}) {
  const log = [];
  const view = { innerWidth: 1280, innerHeight: 800, screenX: 0, screenY: 0 };
  const document = { defaultView: view, elementFromPoint: () => hit?.() ?? null };
  const context = { PointerEvent: FakePointerEvent, MouseEvent: FakeMouseEvent, window: view };
  vm.createContext(context);
  vm.runInContext(source, context);
  const attach = (el) => { el.ownerDocument = document; el.log = log; return el; };
  return { context, log, attach, setHit: (fn) => { hit = fn; } };
}

describe('dispatchPointerClick', () => {
  it('dispatches the full pointer/mouse sequence at the element centre', () => {
    const h = harness();
    const el = h.attach(makeElement({ className: 'KaratButtonRich clickEffect' }));
    h.setHit(() => el);
    const seen = [];
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.addEventListener(t, (e) => seen.push([t, e.init.clientX, e.init.clientY, e.init.button, e.init.buttons]));
    }

    const result = h.context.dispatchPointerClick(el);

    assert.deepEqual(h.log, [
      'pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove',
      'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click',
    ]);
    assert.deepEqual(seen, [
      ['pointerdown', 120, 210, 0, 1],
      ['mousedown', 120, 210, 0, 1],
      ['pointerup', 120, 210, 0, 0],
      ['mouseup', 120, 210, 0, 0],
      ['click', 120, 210, 0, 0],
    ]);
    assert.equal(el.clicked, 0, 'must not fall back to element.click()');
    assert.equal(result.method, 'pointer-sequence');
    assert.equal(result.trusted, false);
    assert.equal(result.obscuredBy, null);
    assert.equal(result.target, 'div.KaratButtonRich.clickEffect');
  });

  it('targets the descendant under the point so event.target matches a real click', () => {
    const h = harness();
    const button = h.attach(makeElement({ className: 'GroupItem' }));
    const span = h.attach(makeElement({ tagName: 'SPAN', className: 'Span', parent: button }));
    h.setHit(() => span);
    let target = null;
    button.addEventListener('click', (e) => { target = e.target; });

    const result = h.context.dispatchPointerClick(button);

    assert.equal(target, span);
    assert.equal(result.target, 'span.Span');
    assert.equal(result.obscuredBy, null);
  });

  it('reports an overlay covering the element and still targets the element', () => {
    const h = harness();
    const el = h.attach(makeElement({ id: 'submit' }));
    const overlay = h.attach(makeElement({ className: 'modal-backdrop' }));
    h.setHit(() => overlay);
    let clicks = 0;
    el.addEventListener('click', () => { clicks += 1; });

    const result = h.context.dispatchPointerClick(el);

    assert.equal(clicks, 1);
    assert.equal(result.target, 'div#submit');
    assert.equal(result.obscuredBy, 'div.modal-backdrop');
  });

  it('cancelled pointerdown suppresses mousedown/mouseup but keeps focus, pointerup and click', () => {
    const h = harness();
    const el = h.attach(makeElement());
    el.focusable = true;
    h.setHit(() => el);
    el.addEventListener('pointerdown', (e) => e.preventDefault());

    h.context.dispatchPointerClick(el);

    assert.ok(!h.log.includes('mousedown'));
    assert.ok(!h.log.includes('mouseup'));
    assert.ok(h.log.includes('pointerup'));
    assert.equal(h.log.at(-1), 'click');
    assert.equal(el.focused, 1, 'browsers still focus when only pointerdown is cancelled');
  });

  it('cancelled mousedown prevents focus', () => {
    const h = harness();
    const el = h.attach(makeElement());
    el.focusable = true;
    h.setHit(() => el);
    el.addEventListener('mousedown', (e) => e.preventDefault());

    h.context.dispatchPointerClick(el);

    assert.equal(el.focused, 0);
    assert.equal(h.log.at(-1), 'click');
  });

  it('focuses the closest focusable ancestor between mousedown and pointerup', () => {
    const h = harness();
    const input = h.attach(makeElement({ tagName: 'INPUT' }));
    input.focusable = true;
    h.setHit(() => input);

    h.context.dispatchPointerClick(input);

    assert.equal(input.focused, 1);
    const i = h.log.indexOf('focus');
    assert.ok(i > h.log.indexOf('mousedown') && i < h.log.indexOf('pointerup'));
  });

  it('falls back to element.click() for zero-size elements', () => {
    const h = harness();
    const el = h.attach(makeElement({ rect: { left: 0, top: 0, width: 0, height: 0 } }));

    const result = h.context.dispatchPointerClick(el);

    assert.equal(el.clicked, 1);
    assert.equal(result.method, 'element.click');
    assert.deepEqual(h.log, []);
  });

  it('reports defaultPrevented when a listener cancels the click', () => {
    const h = harness();
    const el = h.attach(makeElement());
    h.setHit(() => el);
    el.addEventListener('click', (e) => e.preventDefault());

    assert.equal(h.context.dispatchPointerClick(el).defaultPrevented, true);
  });
});

describe('waitForStableRect', () => {
  it('waits until the element stops moving (smooth scroll), not just two frames', async () => {
    const tops = [900, 700, 500, 350, 300, 300, 300, 300];
    let frame = 0;
    const context = {
      requestAnimationFrame: (cb) => { frame += 1; setImmediate(cb); },
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    const el = { getBoundingClientRect: () => ({ top: tops[Math.min(frame, tops.length - 1)], left: 10 }) };

    await context.waitForStableRect(el);

    assert.ok(frame >= 6, `returned after ${frame} frames, while still moving`);
    assert.equal(el.getBoundingClientRect().top, 300);
  });

  it('gives up after maxFrames when the element never settles', async () => {
    let frame = 0;
    const context = { requestAnimationFrame: (cb) => { frame += 1; setImmediate(cb); } };
    vm.createContext(context);
    vm.runInContext(source, context);
    const el = { getBoundingClientRect: () => ({ top: frame, left: 0 }) };

    await context.waitForStableRect(el, 10);

    assert.equal(frame, 10);
  });
});
