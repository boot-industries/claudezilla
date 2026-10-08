/**
 * Claudezilla pointer click
 *
 * Dispatches the event sequence a real mouse click produces
 * (pointerover → pointerenter → mouseover → mouseenter → pointermove →
 * mousemove → pointerdown → mousedown → focus → pointerup → mouseup → click)
 * at the centre of the element.
 *
 * element.click() fires a lone `click` event. Web apps whose custom
 * controls react to pointerdown/mousedown/mouseup (div-based buttons,
 * Blazor and similar component libraries, many ERP web clients) ignore
 * it. A WebExtension in Firefox cannot produce trusted input events, so
 * every event here still has isTrusted === false; pages that explicitly
 * check isTrusted will keep ignoring the click.
 *
 * Loaded as a content script before content.js; exposes dispatchPointerClick().
 */

const POINTER_CLICK_FOCUSABLE =
  'a[href], area[href], button, input, select, textarea, iframe, summary, [tabindex], [contenteditable=""], [contenteditable="true"]';

/**
 * Short description of an element for tool results
 * @param {Element} el
 * @returns {string}
 */
function describeClickTarget(el) {
  if (!el || !el.tagName) return null;
  let desc = el.tagName.toLowerCase();
  if (el.id) desc += `#${el.id}`;
  const cls = typeof el.className === 'string' ? el.className.trim() : '';
  if (cls) desc += '.' + cls.split(/\s+/).slice(0, 3).join('.');
  return desc;
}

/**
 * Wait until the element stops moving, e.g. after
 * scrollIntoView({ behavior: 'smooth' }). Two animation frames are not
 * enough for a smooth scroll; measuring mid-scroll aims the click at
 * whatever is under a stale position.
 *
 * @param {Element} element
 * @param {number} maxFrames - Upper bound (~1s at 60 fps)
 * @returns {Promise<void>}
 */
async function waitForStableRect(element, maxFrames = 60) {
  let prev = null;
  let stableFrames = 0;
  for (let i = 0; i < maxFrames; i++) {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const r = element.getBoundingClientRect();
    if (prev && r.top === prev.top && r.left === prev.left) {
      if (++stableFrames >= 2) return;
    } else {
      stableFrames = 0;
    }
    prev = r;
  }
}

/**
 * Dispatch a full pointer/mouse click sequence on an element.
 * The element should already be scrolled into view (see waitForStableRect).
 *
 * @param {Element} element - Element selected by the caller
 * @returns {object} { method, trusted, x, y, target, obscuredBy, defaultPrevented }
 */
function dispatchPointerClick(element) {
  const rect = element.getBoundingClientRect();

  // Nothing to aim at (display:none, zero-size). Keep the old behaviour.
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    element.click();
    return { method: 'element.click', reason: 'zero-size', trusted: false, x: null, y: null, target: describeClickTarget(element), obscuredBy: null, defaultPrevented: false };
  }

  const view = element.ownerDocument.defaultView || window;
  const x = Math.min(Math.max(rect.left + rect.width / 2, 0), Math.max(view.innerWidth - 1, 0));
  const y = Math.min(Math.max(rect.top + rect.height / 2, 0), Math.max(view.innerHeight - 1, 0));

  // A real mouse hits the topmost element at the point. When that is the
  // element itself or one of its descendants, target it, so event.target
  // matches a real click. When something else covers the element, still
  // target the requested element (the selector expresses intent) and
  // report what was on top.
  const hit = element.ownerDocument.elementFromPoint(x, y);
  const hitInside = hit && (hit === element || element.contains(hit));
  const target = hitInside ? hit : element;
  const obscuredBy = hit && !hitInside ? describeClickTarget(hit) : null;

  const base = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view,
    clientX: x,
    clientY: y,
    screenX: x + (view.mozInnerScreenX ?? view.screenX ?? 0),
    screenY: y + (view.mozInnerScreenY ?? view.screenY ?? 0),
    button: 0,
    buttons: 0,
    detail: 0,
  };
  const pointer = { pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 };

  // dispatchEvent() returns false when a listener called preventDefault()
  const firePointer = (type, extra = {}) =>
    target.dispatchEvent(new PointerEvent(type, { ...base, ...pointer, ...extra }));
  const fireMouse = (type, extra = {}) =>
    target.dispatchEvent(new MouseEvent(type, { ...base, ...extra }));
  const noBubble = { bubbles: false, cancelable: false };

  // Hover
  firePointer('pointerover');
  firePointer('pointerenter', noBubble);
  fireMouse('mouseover');
  fireMouse('mouseenter', noBubble);
  firePointer('pointermove');
  fireMouse('mousemove');

  // Press. A cancelled pointerdown suppresses the compatibility mouse
  // events (Pointer Events spec), but pointerup and click still happen.
  const down = { buttons: 1, pressure: 0.5 };
  const pointerDownOk = firePointer('pointerdown', down);
  let mouseDownOk = true;
  if (pointerDownOk) {
    mouseDownOk = fireMouse('mousedown', { ...down, detail: 1 });
  }

  // Default action of mousedown: focus the closest focusable ancestor.
  // Only a cancelled mousedown prevents it; cancelling pointerdown alone
  // does not (same as in browsers).
  if (mouseDownOk) {
    const focusable = target.closest ? target.closest(POINTER_CLICK_FOCUSABLE) : null;
    if (focusable && typeof focusable.focus === 'function') {
      focusable.focus({ preventScroll: true });
    }
  }

  // Release
  firePointer('pointerup', { pressure: 0 });
  if (pointerDownOk) {
    fireMouse('mouseup', { detail: 1 });
  }
  const clickOk = fireMouse('click', { detail: 1 });

  return {
    method: 'pointer-sequence',
    trusted: false,
    x: Math.round(x),
    y: Math.round(y),
    target: describeClickTarget(target),
    obscuredBy,
    defaultPrevented: !clickOk,
  };
}
