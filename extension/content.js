/**
 * Claudezilla Content Script
 *
 * Runs in web pages and handles DOM interaction commands.
 */

/**
 * Get page content
 * @param {object} params - Parameters
 * @param {string} params.selector - Optional CSS selector to get specific element
 * @returns {object} Page content
 */
function getContent(params = {}) {
  const { selector } = params;

  if (selector) {
    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }
    return {
      selector,
      text: element.textContent?.trim(),
      html: element.innerHTML,
      tagName: element.tagName.toLowerCase(),
    };
  }

  return {
    url: window.location.href,
    title: document.title,
    text: document.body?.textContent?.trim(),
    html: document.documentElement.outerHTML,
  };
}

/**
 * Click an element
 * @param {object} params - Parameters
 * @param {string} params.selector - CSS selector for element to click
 * @returns {object} Result
 */
function click(params) {
  const { selector } = params;

  if (!selector) {
    throw new Error('selector is required');
  }

  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  // Scroll element into view
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Simulate click
  element.click();

  return {
    selector,
    clicked: true,
    tagName: element.tagName.toLowerCase(),
  };
}

/**
 * Type text into an input element
 * @param {object} params - Parameters
 * @param {string} params.selector - CSS selector for input element
 * @param {string} params.text - Text to type
 * @param {boolean} params.clear - Whether to clear existing value first
 * @returns {object} Result
 */
function type(params) {
  const { selector, text, clear = true } = params;

  if (!selector) {
    throw new Error('selector is required');
  }

  if (text === undefined) {
    throw new Error('text is required');
  }

  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  // Check if element is an input or textarea
  const isInput = element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';
  const isContentEditable = element.isContentEditable;

  if (!isInput && !isContentEditable) {
    throw new Error(`Element is not editable: ${selector}`);
  }

  // Focus the element
  element.focus();

  if (isInput) {
    if (clear) {
      element.value = '';
    }
    element.value += text;

    // Dispatch input event
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (isContentEditable) {
    if (clear) {
      element.textContent = '';
    }
    element.textContent += text;

    // Dispatch input event
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }

  return {
    selector,
    typed: text,
    currentValue: isInput ? element.value : element.textContent,
  };
}

/**
 * Handle messages from background script
 */
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, params } = message;

  console.log('[claudezilla-content] Received:', action, params);

  try {
    let result;

    switch (action) {
      case 'getContent':
        result = getContent(params);
        break;

      case 'click':
        result = click(params);
        break;

      case 'type':
        result = type(params);
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    sendResponse({ success: true, result });
  } catch (error) {
    console.error('[claudezilla-content] Error:', error);
    sendResponse({ success: false, error: error.message });
  }

  return true;
});

console.log('[claudezilla-content] Content script loaded on', window.location.href);
