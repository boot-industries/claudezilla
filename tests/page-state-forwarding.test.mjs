import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const contentSource = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');

function createPageStateHarness() {
  let runtimeListener = null;

  const browser = {
    runtime: {
      onMessage: {
        addListener(listener) {
          runtimeListener = listener;
        },
      },
    },
    storage: {
      local: {
        async get() { return {}; },
      },
      onChanged: {
        addListener() {},
      },
    },
  };

  const longHeading = 'H'.repeat(150);
  const shortHeading = 'Short Heading';
  const longLinkText = 'L'.repeat(80);
  const longHref = 'https://example.com/' + 'a'.repeat(120);
  const longButton = 'B'.repeat(70);
  const longInputValue = 'V'.repeat(65);
  const passwordInputValue = 'SuperSecret123';
  const longImageAlt = 'I'.repeat(110);
  const longImageSrc = 'https://example.com/images/' + 'x'.repeat(100);

  const mockHeading1 = {
    tagName: 'H1',
    textContent: longHeading,
  };
  const mockHeading2 = {
    tagName: 'H2',
    textContent: shortHeading,
  };
  const mockLink = {
    getBoundingClientRect() { return { width: 50, height: 20 }; },
    textContent: longLinkText,
    getAttribute(attr) {
      if (attr === 'href') return longHref;
      return null;
    },
  };
  const mockButton = {
    getBoundingClientRect() { return { width: 50, height: 20 }; },
    textContent: longButton,
    disabled: false,
    getAttribute() { return null; },
    type: 'button',
  };
  const mockTextInput = {
    getBoundingClientRect() { return { width: 100, height: 30 }; },
    type: 'text',
    name: 'testName',
    id: 'testId',
    value: longInputValue,
    required: true,
    disabled: false,
    getAttribute() { return null; },
    placeholder: 'Enter text',
  };
  const mockPasswordInput = {
    getBoundingClientRect() { return { width: 100, height: 30 }; },
    type: 'password',
    name: 'userPassword',
    id: 'pwdId',
    value: passwordInputValue,
    required: true,
    disabled: false,
    getAttribute() { return null; },
    placeholder: 'Password',
  };
  const mockImage = {
    getBoundingClientRect() { return { width: 50, height: 50 }; },
    alt: longImageAlt,
    src: longImageSrc,
  };

  const mockDocument = {
    title: 'Page State Test',
    readyState: 'complete',
    head: { appendChild() {}, querySelector() { return null; } },
    body: { appendChild() {}, removeChild() {} },
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
          return {
            appendChild() {},
            querySelector() { return null; },
            querySelectorAll() { return []; },
          };
        },
      };
    },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector.includes('h1, h2')) return [mockHeading1, mockHeading2];
      if (selector.includes('a[href]')) return [mockLink];
      if (selector.includes('button')) return [mockButton];
      if (selector.includes('input, textarea, select')) return [mockTextInput, mockPasswordInput];
      if (selector.includes('img[alt]')) return [mockImage];
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
  };

  const windowObj = {
    location: { href: 'https://example.com/page' },
    innerWidth: 1024,
    innerHeight: 768,
    scrollX: 0,
    scrollY: 0,
    addEventListener() {},
    removeEventListener() {},
  };
  windowObj.window = windowObj;
  windowObj.top = windowObj;

  const context = vm.createContext({
    browser,
    window: windowObj,
    document: mockDocument,
    console: {
      log() {},
      warn() {},
      error() {},
      info() {},
      debug() {},
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    DOMParser: class {
      parseFromString() {
        return {
          documentElement: {
            querySelector() { return null; },
            querySelectorAll() { return []; },
          },
        };
      }
    },
  });

  vm.runInContext(contentSource, context);

  return {
    sendMessage(message) {
      assert.ok(runtimeListener, 'Runtime listener not set');
      return new Promise((resolve) => {
        runtimeListener(message, {}, resolve);
      });
    },
  };
}

describe('page state parameter forwarding and truncation metadata', () => {
  it('returns explicit truncation metadata for values exceeding limits while preserving password mask', async () => {
    const harness = createPageStateHarness();

    const res = await harness.sendMessage({
      action: 'getPageState',
      params: {
        maxHeadings: 1, // Parameter override: should only return 1 heading
      },
    });

    assert.equal(res.success, true);
    const { headings, links, buttons, inputs, images, counts } = res.result;

    // Headings limit override respected
    assert.equal(headings.length, 1);
    assert.equal(counts.headings.shown, 1);
    assert.equal(counts.headings.total, 2);

    // Truncation metadata on heading
    assert.equal(headings[0].text.length, 100);
    assert.equal(headings[0].truncated, true);
    assert.equal(headings[0].rawLength, 150);

    // Links truncation
    assert.equal(links[0].text.length, 50);
    assert.equal(links[0].href.length, 100);
    assert.equal(links[0].truncated, true);

    // Buttons truncation
    assert.equal(buttons[0].text.length, 50);
    assert.equal(buttons[0].truncated, true);

    // Inputs: text input truncated, password input strictly masked as '***'
    const textInput = inputs.find(i => i.name === 'testName');
    assert.ok(textInput);
    assert.equal(textInput.value.length, 50);
    assert.equal(textInput.truncated, true);

    const pwdInput = inputs.find(i => i.name === 'userPassword');
    assert.ok(pwdInput);
    assert.equal(pwdInput.value, '***');
    assert.equal(pwdInput.truncated, undefined); // Never flag or expose raw password info

    // Images truncation
    assert.equal(images[0].alt.length, 100);
    assert.equal(images[0].src.length, 100);
    assert.equal(images[0].truncated, true);
  });
});
