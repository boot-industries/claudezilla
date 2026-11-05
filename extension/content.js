/**
 * Claudezilla Content Script
 *
 * Runs in web pages and handles DOM interaction commands.
 * Includes devtools features: console capture, scroll, wait, evaluate.
 * Visual features: Claude sparkle watermark, focusglow.
 */

// ===== VISUAL EFFECTS =====

// Settings (loaded from storage)
let settings = {
  showWatermark: true,
  showFocusglow: true,
  allowEvaluate: false,  // SECURITY: firefox_evaluate requires explicit opt-in (AMO compliance)
};

// Visual elements
let watermarkElement = null;
let watermarkShadow = null;  // Shadow DOM root for watermark
let electronsElement = null;  // Reference inside shadow DOM
let armsElement = null;       // Reference inside shadow DOM
let focusglowElement = null;
let speechBubbleElement = null;
let focusglowTimeout = null;
let electronTimeout = null;

/**
 * Claude logo SVG (interconnected knot pattern - animated)
 * Based on Anthropic's Claude brand mark
 */
const CLAUDE_LOGO_SVG = `
<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Brighter gradient for electron glow -->
    <radialGradient id="electronGlow">
      <stop offset="0%" stop-color="#fff" stop-opacity="1"/>
      <stop offset="30%" stop-color="#FFE4D6" stop-opacity="0.95"/>
      <stop offset="60%" stop-color="#E05A38" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#D14D32" stop-opacity="0"/>
    </radialGradient>
    <!-- Spine glow gradient -->
    <linearGradient id="wmSpineGlow" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#D14D32" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="#FCD34D" stop-opacity="0.4"/>
    </linearGradient>
    <!-- Soft dissolve glow gradients (stronger) -->
    <radialGradient id="wmGlowOuter" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#D14D32" stop-opacity="0.75"/>
      <stop offset="40%" stop-color="#D14D32" stop-opacity="0.55"/>
      <stop offset="70%" stop-color="#D14D32" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#D14D32" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="wmGlowInner" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#E05A38" stop-opacity="0.65"/>
      <stop offset="50%" stop-color="#E05A38" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#E05A38" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Master group scaled around center to fill container -->
  <g id="claudezilla-breathe" transform="translate(32, 32) scale(1.20) translate(-32, -32)">

    <!-- LAYER 1: Tesseract frame -->
    <path d="M32 8 L54 18 L54 46 L32 56 L10 46 L10 18 Z"
          stroke="#D14D32" stroke-width="2.5" fill="none" stroke-linejoin="round" opacity="0.9"/>
    <path d="M32 8 L32 56 M10 18 L54 46 M54 18 L10 46"
          stroke="#D14D32" stroke-width="2" stroke-linecap="round" opacity="0.85"/>

    <!-- LAYER 2: Electrons group (hidden by default, shown when thinking) -->
    <g id="claudezilla-electrons" style="opacity: 0; transition: opacity 1.5s ease-out;">
      <!-- Electron 1: Around outer hexagon -->
      <circle r="3.5" fill="url(#electronGlow)">
        <animateMotion dur="4s" repeatCount="indefinite" path="M32 8 L54 18 L54 46 L32 56 L10 46 L10 18 Z"/>
      </circle>

      <!-- Electron 2: Around outer hexagon (opposite phase) -->
      <circle r="3" fill="url(#electronGlow)">
        <animateMotion dur="4s" repeatCount="indefinite" begin="-2s" path="M32 8 L54 18 L54 46 L32 56 L10 46 L10 18 Z"/>
      </circle>

      <!-- Electron 3: Vertical line -->
      <circle r="2.5" fill="url(#electronGlow)">
        <animateMotion dur="2.5s" repeatCount="indefinite" path="M32 8 L32 56 L32 8"/>
      </circle>

      <!-- Electron 4: Diagonal 1 -->
      <circle r="2.5" fill="url(#electronGlow)">
        <animateMotion dur="3s" repeatCount="indefinite" begin="-0.5s" path="M10 18 L54 46 L10 18"/>
      </circle>

      <!-- Electron 5: Diagonal 2 -->
      <circle r="2.5" fill="url(#electronGlow)">
        <animateMotion dur="3s" repeatCount="indefinite" begin="-1.5s" path="M54 18 L10 46 L54 18"/>
      </circle>
    </g>

    <!-- LAYER 3: Glow (behind character) - soft dissolve edges, expanded -->
    <g transform="translate(32, 32) scale(1.2)">
      <ellipse cx="0" cy="0" rx="14" ry="16" fill="url(#wmGlowOuter)"/>
      <ellipse cx="0" cy="0" rx="9" ry="11" fill="url(#wmGlowInner)"/>
    </g>

    <!-- LAYER 4: Arms (only visible when working - AFTER glow so in front) -->
    <g id="claudezilla-arms" style="opacity: 0; transition: opacity 1.5s ease-out;">
      <g transform="translate(32, 32) scale(1.2)">
        <!-- Left arm glow -->
        <path d="M-4.5 0 L-7 -2" stroke="#D14D32" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.6">
          <animateTransform attributeName="transform" type="rotate" values="0 -4.5 0; -25 -4.5 0; 0 -4.5 0" dur="0.5s" repeatCount="indefinite"/>
        </path>
        <!-- Left arm -->
        <path d="M-4.5 0 L-7 -2" stroke="#1a1a1a" stroke-width="1" stroke-linecap="round" fill="none">
          <animateTransform attributeName="transform" type="rotate" values="0 -4.5 0; -25 -4.5 0; 0 -4.5 0" dur="0.5s" repeatCount="indefinite"/>
        </path>
        <!-- Right arm glow -->
        <path d="M4.5 0 L7 -2" stroke="#D14D32" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.6">
          <animateTransform attributeName="transform" type="rotate" values="0 4.5 0; 25 4.5 0; 0 4.5 0" dur="0.5s" repeatCount="indefinite" begin="0.25s"/>
        </path>
        <!-- Right arm -->
        <path d="M4.5 0 L7 -2" stroke="#1a1a1a" stroke-width="1" stroke-linecap="round" fill="none">
          <animateTransform attributeName="transform" type="rotate" values="0 4.5 0; 25 4.5 0; 0 4.5 0" dur="0.5s" repeatCount="indefinite" begin="0.25s"/>
        </path>
      </g>
    </g>

    <!-- LAYER 5: Character (spines + body + eye - ALL in one group) -->
    <g transform="translate(32, 32) scale(1.2)">
      <!-- Spine glows (behind dark cones) -->
      <path d="M-0.8 -6 L0 -10 L0.8 -6" fill="url(#wmSpineGlow)" opacity="0.7">
        <animate attributeName="opacity" values="0.5;0.8;0.5" dur="2s" repeatCount="indefinite"/>
      </path>
      <path d="M1.5 -4 L3.5 -8 L3.5 -3.5" fill="url(#wmSpineGlow)" opacity="0.7">
        <animate attributeName="opacity" values="0.5;0.8;0.5" dur="2s" repeatCount="indefinite" begin="0.3s"/>
      </path>
      <path d="M-1.5 -4 L-3.5 -8 L-3.5 -3.5" fill="url(#wmSpineGlow)" opacity="0.7">
        <animate attributeName="opacity" values="0.5;0.8;0.5" dur="2s" repeatCount="indefinite" begin="0.6s"/>
      </path>
      <!-- Spine dark cones -->
      <path d="M-0.7 -6 L0 -10 L0.7 -6 Z" fill="#1a1a1a"/>
      <path d="M1.8 -4 L3.5 -8 L3.2 -3.5 Z" fill="#1a1a1a"/>
      <path d="M-1.8 -4 L-3.5 -8 L-3.2 -3.5 Z" fill="#1a1a1a"/>
      <!-- Body -->
      <path d="M-4 6 L-4 0 L-5 -2 L-5 -4 L-4 -5 L-2 -5 L0 -7 L2 -5 L4 -5 L5 -4 L5 -2 L4 0 L4 6 L2 6 L2 2 L1 3 L-1 3 L-2 2 L-2 6 Z" fill="#1a1a1a"/>
      <!-- Eye (offset right for profile look) -->
      <circle cx="1" cy="-3" r="1.5" fill="#FCD34D"/>
    </g>

  </g>
</svg>
`;

/**
 * Watermark shadow-DOM stylesheet (assigned via textContent — safe per AMO)
 */
const WATERMARK_SHADOW_CSS = `
  :host {
    display: block;
    position: relative;
  }
  .watermark-inner {
    position: relative;
    width: 100%;
    height: 100%;
    background: rgba(20, 18, 18, 0.94);
    border-radius: 14px;
    padding: 12px;
    opacity: 0.95;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: visible;
    animation: claudezilla-glow-throb 4s ease-in-out infinite;
    transition: opacity 0.3s ease, transform 0.15s ease;
    box-sizing: border-box;
  }
  .watermark-inner:hover {
    transform: scale(1.05);
  }
  @keyframes claudezilla-glow-throb {
    0% {
      box-shadow:
        0 0 20px 4px rgba(209, 77, 50, 0.5),
        0 0 40px 8px rgba(209, 77, 50, 0.25),
        0 0 60px 12px rgba(209, 77, 50, 0.1),
        0 4px 16px rgba(0, 0, 0, 0.5),
        inset 0 0 0 1px rgba(209, 77, 50, 0.3);
    }
    25% {
      box-shadow:
        0 0 28px 6px rgba(209, 77, 50, 0.6),
        0 0 52px 12px rgba(209, 77, 50, 0.35),
        0 0 80px 18px rgba(209, 77, 50, 0.15),
        0 4px 16px rgba(0, 0, 0, 0.5),
        inset 0 0 0 1px rgba(209, 77, 50, 0.4);
    }
    100% {
      box-shadow:
        0 0 20px 4px rgba(209, 77, 50, 0.5),
        0 0 40px 8px rgba(209, 77, 50, 0.25),
        0 0 60px 12px rgba(209, 77, 50, 0.1),
        0 4px 16px rgba(0, 0, 0, 0.5),
        inset 0 0 0 1px rgba(209, 77, 50, 0.3);
    }
  }
  /* Speech bubble styles */
  @keyframes claudezilla-bubble-pop {
    0% { transform: scale(0); opacity: 0; }
    70% { transform: scale(1.1); }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes claudezilla-note-bob {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-1px); }
  }
  /* LOCKED COORDINATES - calibrated 2026-01-06, do not change */
  .speech-bubble {
    position: absolute !important;
    top: 36px !important;
    right: 32px !important;
    left: auto !important;
    bottom: auto !important;
    margin: 0 !important;
    width: 8px;
    height: 8px;
    background: #f5f5f4;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    opacity: 0;
    transform: scale(0);
    pointer-events: none;
    box-shadow: 0 1px 2px rgba(0,0,0,0.25);
  }
  .speech-bubble.singing {
    opacity: 1;
    transform: scale(1);
    animation: claudezilla-bubble-pop 0.25s ease-out forwards;
  }
  .speech-bubble .note {
    font-size: 7px;
    color: #1a1a1a;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    line-height: 1;
    animation: claudezilla-note-bob 0.5s ease-in-out infinite;
  }
  .speech-bubble::after {
    content: '';
    position: absolute;
    bottom: -2px;
    left: -1px;
    width: 0;
    height: 0;
    border: 3px solid transparent;
    border-top-color: #f5f5f4;
    transform: rotate(-45deg);
  }
`;

/**
 * Initialize watermark (Claude logo badge)
 */
function initWatermark() {
  if (watermarkElement) return;

  // Shadow DOM provides complete CSS isolation - no external styles needed
  watermarkElement = document.createElement('div');
  watermarkElement.id = 'claudezilla-watermark';

  // Use Shadow DOM to completely isolate from page CSS
  // Store reference since we need to access elements inside for triggerElectrons
  watermarkShadow = watermarkElement.attachShadow({ mode: 'closed' });

  // Container styling (on host element, outside shadow)
  watermarkElement.style.cssText = `
    position: fixed;
    bottom: 16px;
    left: 16px;
    width: 100px;
    height: 100px;
    z-index: 2147483647;
    pointer-events: auto;
    cursor: pointer;
  `;

  // SECURITY (AMO compliance): Build shadow DOM via DOM APIs instead of innerHTML
  // assignment. Avoids UNSAFE_VAR_ASSIGNMENT lint warning even though all inputs
  // are static. <style> uses textContent; SVG is parsed via DOMParser then imported.
  const styleEl = document.createElement('style');
  styleEl.textContent = WATERMARK_SHADOW_CSS;
  watermarkShadow.appendChild(styleEl);

  const innerDiv = document.createElement('div');
  innerDiv.className = 'watermark-inner';

  const svgDoc = new DOMParser().parseFromString(CLAUDE_LOGO_SVG, 'image/svg+xml');
  innerDiv.appendChild(document.importNode(svgDoc.documentElement, true));

  const bubbleDiv = document.createElement('div');
  bubbleDiv.className = 'speech-bubble';
  const noteSpan = document.createElement('span');
  noteSpan.className = 'note';
  noteSpan.textContent = '♪';  // ♪
  bubbleDiv.appendChild(noteSpan);
  innerDiv.appendChild(bubbleDiv);

  watermarkShadow.appendChild(innerDiv);

  // Click to open extension popup
  watermarkElement.addEventListener('click', () => {
    browser.runtime.sendMessage({ action: 'openPopup' });
  });

  document.body.appendChild(watermarkElement);

  // Store references to elements inside shadow DOM for triggerElectrons
  speechBubbleElement = watermarkShadow.querySelector('.speech-bubble');
  electronsElement = watermarkShadow.querySelector('#claudezilla-electrons');
  armsElement = watermarkShadow.querySelector('#claudezilla-arms');
}

/**
 * Initialize focusglow element
 */
function initFocusglow() {
  if (focusglowElement) return;
  if (document.head.querySelector('#claudezilla-focusglow-styles')) return;

  // Inject CSS animation
  const style = document.createElement('style');
  style.id = 'claudezilla-focusglow-styles';
  style.textContent = `
    @keyframes claudezilla-sparkle {
      0%, 100% {
        opacity: 0.85;
        transform: scale(1);
        box-shadow:
          0 0 12px 4px rgba(255, 215, 0, 0.7),
          0 0 24px 8px rgba(255, 165, 0, 0.5),
          0 0 40px 16px rgba(255, 215, 0, 0.25),
          inset 0 0 8px rgba(255, 215, 0, 0.3);
      }
      50% {
        opacity: 1;
        transform: scale(1.01);
        box-shadow:
          0 0 16px 6px rgba(255, 215, 0, 0.8),
          0 0 32px 12px rgba(255, 165, 0, 0.6),
          0 0 48px 20px rgba(255, 215, 0, 0.3),
          inset 0 0 12px rgba(255, 215, 0, 0.4);
      }
    }
    @keyframes claudezilla-dust {
      0% { transform: translate(0, 0) scale(1); opacity: 0.8; }
      25% { transform: translate(3px, -8px) scale(0.8); opacity: 1; }
      50% { transform: translate(-2px, -12px) scale(0.6); opacity: 0.6; }
      75% { transform: translate(4px, -16px) scale(0.4); opacity: 0.3; }
      100% { transform: translate(0, -20px) scale(0.2); opacity: 0; }
    }
    @keyframes claudezilla-dust-reverse {
      0% { transform: translate(0, 0) scale(1); opacity: 0.8; }
      25% { transform: translate(-4px, -6px) scale(0.7); opacity: 1; }
      50% { transform: translate(2px, -10px) scale(0.5); opacity: 0.5; }
      75% { transform: translate(-3px, -14px) scale(0.3); opacity: 0.2; }
      100% { transform: translate(1px, -18px) scale(0.1); opacity: 0; }
    }
    #claudezilla-focusglow {
      position: absolute;
      pointer-events: none;
      z-index: 2147483646;
      border-radius: 6px;
      border: 3px solid rgba(255, 215, 0, 0.9);
      background: rgba(255, 215, 0, 0.15);
      box-shadow:
        0 0 15px 6px rgba(255, 215, 0, 0.8),
        0 0 30px 12px rgba(255, 165, 0, 0.6),
        0 0 50px 20px rgba(255, 215, 0, 0.35);
      animation: claudezilla-sparkle 1.5s ease-in-out infinite;
      transition: top 0.3s ease-out, left 0.3s ease-out, width 0.3s ease-out, height 0.3s ease-out;
      display: none;
      opacity: 0;
    }
    #claudezilla-focusglow.visible {
      opacity: 1;
      transition: top 0.3s ease-out, left 0.3s ease-out, width 0.3s ease-out, height 0.3s ease-out, opacity 1s ease-in;
    }
    #claudezilla-focusglow.fading {
      opacity: 0;
      transition: top 0.3s ease-out, left 0.3s ease-out, width 0.3s ease-out, height 0.3s ease-out, opacity 2s ease-out;
    }
    #claudezilla-focusglow.visible::before,
    #claudezilla-focusglow.visible::after {
      content: '';
      position: absolute;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(255,215,0,0.8) 50%, transparent 100%);
      pointer-events: none;
    }
    #claudezilla-focusglow.visible::before {
      top: 20%;
      left: 10%;
      animation: claudezilla-dust 1.8s ease-out infinite;
      box-shadow:
        30px 10px 0 0 rgba(255,215,0,0.7),
        60px -5px 0 -1px rgba(255,255,255,0.6),
        90px 15px 0 0 rgba(255,215,0,0.5);
    }
    #claudezilla-focusglow.visible::after {
      top: 60%;
      right: 15%;
      animation: claudezilla-dust-reverse 2.2s ease-out infinite 0.5s;
      box-shadow:
        -25px -10px 0 0 rgba(255,215,0,0.6),
        -55px 5px 0 -1px rgba(255,255,255,0.5),
        -80px -8px 0 0 rgba(255,215,0,0.4);
    }
  `;
  document.head.appendChild(style);

  focusglowElement = document.createElement('div');
  focusglowElement.id = 'claudezilla-focusglow';
  document.body.appendChild(focusglowElement);
}

/**
 * Move focusglow to an element
 * @param {Element} el - Target element
 */
function moveFocusTo(el) {
  if (!settings.showFocusglow || !focusglowElement || !el) {
    return;
  }

  const rect = el.getBoundingClientRect();
  focusglowElement.style.display = 'block';
  focusglowElement.style.top = `${rect.top + window.scrollY - 4}px`;
  focusglowElement.style.left = `${rect.left + window.scrollX - 4}px`;
  focusglowElement.style.width = `${rect.width + 8}px`;
  focusglowElement.style.height = `${rect.height + 8}px`;

  // Fade in (1s)
  focusglowElement.classList.remove('fading');
  focusglowElement.classList.add('visible');

  // Fade out after idle (2s fade)
  clearTimeout(focusglowTimeout);
  focusglowTimeout = setTimeout(() => {
    if (focusglowElement) {
      focusglowElement.classList.remove('visible');
      focusglowElement.classList.add('fading');
      // Hide after fade completes
      setTimeout(() => {
        if (focusglowElement && focusglowElement.classList.contains('fading')) {
          focusglowElement.style.display = 'none';
          focusglowElement.classList.remove('fading');
        }
      }, 2000);
    }
  }, 2000);
}

/**
 * Trigger electron animation (shows Claude is thinking/working)
 */
function triggerElectrons() {
  if (!settings.showWatermark || !watermarkElement) return;
  if (!electronsElement) return;

  // Show electrons, arms, and speech bubble (Claudezilla sings while working!)
  electronsElement.style.opacity = '1';
  if (armsElement) armsElement.style.opacity = '1';
  if (speechBubbleElement) speechBubbleElement.classList.add('singing');

  // Hide after 5s idle (with gradual 1.5s fade)
  clearTimeout(electronTimeout);
  electronTimeout = setTimeout(() => {
    electronsElement.style.opacity = '0';
    if (armsElement) armsElement.style.opacity = '0';
    if (speechBubbleElement) speechBubbleElement.classList.remove('singing');
  }, 5000);
}

/**
 * Update visual elements based on settings
 */
function updateVisuals() {
  if (watermarkElement) {
    watermarkElement.style.display = settings.showWatermark ? 'flex' : 'none';
  }
  if (focusglowElement && !settings.showFocusglow) {
    focusglowElement.style.display = 'none';
  }
}

/**
 * Load settings from storage
 */
let settingsLoaded = null;  // Promise resolved once storage has been read

async function loadSettings() {
  try {
    const stored = await browser.storage.local.get('claudezilla');
    if (stored.claudezilla) {
      settings = { ...settings, ...stored.claudezilla };
    }
    updateVisuals();
  } catch (e) {
    console.log('[claudezilla] Could not load settings:', e.message);
  }
}

/**
 * Ensure settings have been read from storage at least once.
 * Gated actions (evaluate) must await this, otherwise the first command
 * on a tab can race the async load and see the default allowEvaluate=false.
 */
function ensureSettingsLoaded() {
  if (!settingsLoaded) settingsLoaded = loadSettings();
  return settingsLoaded;
}

/**
 * Initialize visual effects
 */
function initVisuals() {
  // Only initialize in top frame
  if (window !== window.top) return;

  ensureSettingsLoaded();
  initWatermark();
  initFocusglow();
  updateVisuals();

  // Listen for settings changes
  try {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.claudezilla) {
        settings = { ...settings, ...changes.claudezilla.newValue };
        updateVisuals();
      }
    });
  } catch (e) {
    console.log('[claudezilla] Storage listener not available:', e.message);
  }
}

// DON'T auto-initialize visuals - wait for background.js to tell us this is a Claudezilla tab
// initVisuals() will be called via 'enableClaudezillaVisuals' message from background.js

// ===== CONSOLE LOG CAPTURE =====
// SECURITY: Console capture is OPT-IN to prevent leaking sensitive data
// Call enableConsoleCapture() to start capturing, or it auto-enables on first getConsoleLogs call

// Console log capture state
const capturedLogs = [];
const MAX_LOGS = 500;
let consoleCaptureEnabled = false;

const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
};

function captureLog(level, args) {
  // Only capture if enabled
  if (!consoleCaptureEnabled) return;

  const entry = {
    level,
    timestamp: Date.now(),
    message: args.map(arg => {
      try {
        if (typeof arg === 'object') {
          return JSON.stringify(arg, null, 2);
        }
        return String(arg);
      } catch (e) {
        return '[Unserializable]';
      }
    }).join(' '),
  };
  capturedLogs.push(entry);
  if (capturedLogs.length > MAX_LOGS) {
    capturedLogs.shift();
  }
}

/**
 * SECURITY: Enable console capture (opt-in)
 * Only captures logs after this is called
 */
function enableConsoleCapture() {
  if (consoleCaptureEnabled) return;
  consoleCaptureEnabled = true;

  // Override console methods
  console.log = (...args) => { captureLog('log', args); originalConsole.log(...args); };
  console.warn = (...args) => { captureLog('warn', args); originalConsole.warn(...args); };
  console.error = (...args) => { captureLog('error', args); originalConsole.error(...args); };
  console.info = (...args) => { captureLog('info', args); originalConsole.info(...args); };
  console.debug = (...args) => { captureLog('debug', args); originalConsole.debug(...args); };

  // Capture uncaught errors
  window.addEventListener('error', (event) => {
    captureLog('error', [`Uncaught Error: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`]);
  });

  window.addEventListener('unhandledrejection', (event) => {
    captureLog('error', [`Unhandled Promise Rejection: ${event.reason}`]);
  });

  originalConsole.log('[claudezilla] Console capture enabled');
}

/**
 * Get captured console logs
 * SECURITY: Auto-enables capture on first call (opt-in behavior)
 * @param {object} params - Parameters
 * @param {string} params.level - Filter by level (log, warn, error, info, debug)
 * @param {boolean} params.clear - Clear logs after returning
 * @param {number} params.limit - Max logs to return (default 100)
 * @returns {object} Console logs
 */
function getConsoleLogs(params = {}) {
  // SECURITY: Auto-enable capture on first request
  // This makes capture opt-in - logs are only captured after first getConsoleLogs call
  if (!consoleCaptureEnabled) {
    enableConsoleCapture();
  }

  const { level, clear = false, limit = 100 } = params;

  let logs = [...capturedLogs];

  if (level) {
    logs = logs.filter(log => log.level === level);
  }

  logs = logs.slice(-limit);

  if (clear) {
    capturedLogs.length = 0;
  }

  return {
    logs,
    total: capturedLogs.length,
    filtered: logs.length,
    captureEnabled: consoleCaptureEnabled,
  };
}

/**
 * SECURITY: Validate CSS selector syntax before use
 * Prevents selector injection and handles malformed selectors gracefully
 * @param {string} selector - CSS selector to validate
 * @returns {boolean} True if valid
 * @throws {Error} If selector is invalid
 */
function validateSelector(selector) {
  if (!selector || typeof selector !== 'string') {
    throw new Error('selector is required and must be a string');
  }

  // Reject empty or whitespace-only selectors
  if (!selector.trim()) {
    throw new Error('selector cannot be empty');
  }

  // Reject excessively long selectors (potential DoS)
  if (selector.length > 1000) {
    throw new Error('selector too long (max 1000 characters)');
  }

  // Test selector validity by attempting to use it
  try {
    document.querySelector(selector);
    return true;
  } catch (e) {
    throw new Error(`Invalid CSS selector: ${e.message}`);
  }
}

/**
 * SECURITY: Query element with validated selector
 * @param {string} selector - CSS selector
 * @returns {Element|null} Found element or null
 */
function safeQuerySelector(selector) {
  validateSelector(selector);
  return document.querySelector(selector);
}

// ===== ELEMENT REFS =====
// Stable per-document handles (ref_N) for elements returned by snapshots,
// find and page state. A new content-script instance after navigation starts
// again from ref_1, so refs from the previous page resolve as stale.

const refToElement = new Map();      // ref -> WeakRef<Element>
const elementToRef = new WeakMap();  // Element -> ref
let nextRef = 1;
const REF_PRUNE_EVERY = 500;

/**
 * Return the element's ref, assigning a new one on first sight.
 * @param {Element} el
 * @returns {string} ref_N
 */
function refFor(el) {
  const existing = elementToRef.get(el);
  if (existing) return existing;
  const ref = `ref_${nextRef++}`;
  elementToRef.set(el, ref);
  refToElement.set(ref, new WeakRef(el));
  if ((nextRef - 1) % REF_PRUNE_EVERY === 0) {
    for (const [key, weak] of refToElement) {
      if (!weak.deref()) refToElement.delete(key);
    }
  }
  return ref;
}

/**
 * Resolve a ref to its live element.
 * @param {string} ref
 * @returns {Element}
 */
function resolveRef(ref) {
  if (typeof ref !== 'string' || !/^ref_\d+$/.test(ref)) {
    throw new Error(`Invalid ref "${ref}": use a ref_N value from a snapshot or find`);
  }
  const el = refToElement.get(ref)?.deref();
  if (!el || !el.isConnected) {
    refToElement.delete(ref);
    if (el) elementToRef.delete(el);
    throw new Error(`${ref} is stale or not found on the current page. Re-read the page to get fresh references.`);
  }
  return el;
}

/**
 * Resolve the target element of a command: ref wins over selector.
 * With autoWait the selector path returns a Promise (smartQuerySelector);
 * without it the result is synchronous. A selector miss yields null so callers
 * keep their own not-found errors; a bad ref throws.
 * @param {object} params - { ref?, selector? }
 * @param {object} options - { autoWait, timeout }
 * @returns {Element|null|Promise<Element|null>}
 */
function resolveElement(params, { autoWait = false, timeout } = {}) {
  if (hasRef(params)) return resolveRef(params.ref);
  if (params.selector) {
    return autoWait
      ? smartQuerySelector(params.selector, { autoWait: true, timeout })
      : safeQuerySelector(params.selector);
  }
  throw new Error('Provide ref (from a snapshot or find) or selector');
}

/**
 * Describe a command target for results and errors.
 * @param {object} params - { ref?, selector? }
 * @returns {object} { ref } or { selector }
 */
function targetOf(params) {
  return hasRef(params) ? { ref: params.ref } : { selector: params.selector };
}

function hasRef(params) {
  return params.ref !== undefined && params.ref !== null;
}

/**
 * Wait until the page is visible and has painted a frame, capped at timeoutMs.
 * Used after the extension selects a pool tab: a background tab fires
 * visibilitychange when it becomes active, and we proceed as soon as it does
 * instead of sleeping a fixed interval.
 * @param {object} options
 * @param {number} [options.timeoutMs=300]
 * @returns {Promise<{visible: boolean, waitedMs: number}>}
 */
async function awaitVisible({ timeoutMs = 300 } = {}) {
  const start = performance.now();
  if (document.visibilityState !== 'visible') {
    await new Promise(resolve => {
      let timer;
      const onChange = () => {
        if (document.visibilityState === 'visible') finish();
      };
      const finish = () => {
        clearTimeout(timer);
        document.removeEventListener('visibilitychange', onChange);
        resolve();
      };
      timer = setTimeout(finish, timeoutMs);
      document.addEventListener('visibilitychange', onChange);
    });
  }
  await nextFrame();
  return {
    visible: document.visibilityState === 'visible',
    waitedMs: Math.round(performance.now() - start),
  };
}

// ===== AUTO-RETRY SYSTEM (v0.5.0) =====

/**
 * Configuration for intelligent auto-retry
 */
const RETRY_CONFIG = {
  maxAttempts: 3,              // Total attempts (1 initial + 2 retries)
  baseDelay: 100,              // Initial delay in ms
  maxDelay: 1000,              // Cap on exponential backoff
  autoWaitTimeout: 5000,       // Auto-inject waitFor timeout
  enableAutoWait: true,        // Auto-wait for elements before failing
};

/**
 * SMART QUERY: Automatically waits for element with exponential backoff
 * Returns immediately if element exists, otherwise waits up to autoWaitTimeout
 * @param {string} selector - CSS selector
 * @param {object} options - Retry options
 * @returns {Promise<Element|null>} Found element or null
 */
async function smartQuerySelector(selector, options = {}) {
  const {
    autoWait = RETRY_CONFIG.enableAutoWait,
    timeout = RETRY_CONFIG.autoWaitTimeout,
  } = options;

  // Validate selector first
  validateSelector(selector);

  // Attempt 1: Immediate query (fast path)
  let element = document.querySelector(selector);
  if (element) return element;

  // If auto-wait disabled, return null immediately
  if (!autoWait) return null;

  // Attempt 2: Auto-wait for element (up to timeout)
  const startTime = Date.now();
  const pollInterval = 100;

  while (Date.now() - startTime < timeout) {
    // Wait for next frame (bounded: an unpainted tab never fires a frame)
    await nextFrame();
    await nextFrame();

    // Check again
    element = document.querySelector(selector);
    if (element) return element;

    // Poll interval delay
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  // Still not found after timeout
  return null;
}

/**
 * Generate a unique selector for an element
 * @param {Element} element
 * @returns {string} Unique CSS selector
 */
function generateUniqueSelector(element) {
  // Try ID first
  if (element.id) return `#${element.id}`;

  // Try unique class combination
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.split(/\s+/).filter(c => c && !c.includes(':'));
    if (classes.length > 0) {
      const classSelector = classes.map(c => `.${CSS.escape(c)}`).join('');
      try {
        if (document.querySelectorAll(classSelector).length === 1) {
          return classSelector;
        }
      } catch (e) {
        // Invalid selector, continue
      }
    }
  }

  // Try aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    const escapedLabel = ariaLabel.replace(/"/g, '\\"');
    const ariaSelector = `[aria-label="${escapedLabel}"]`;
    try {
      if (document.querySelectorAll(ariaSelector).length === 1) {
        return ariaSelector;
      }
    } catch (e) {
      // Continue to fallback
    }
  }

  // Fallback to tag + nth-child
  let path = element.tagName.toLowerCase();
  let current = element;

  while (current.parentElement && current.parentElement !== document.body) {
    const parent = current.parentElement;
    const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
    if (siblings.length > 1) {
      const index = siblings.indexOf(current) + 1;
      path = `${current.tagName.toLowerCase()}:nth-of-type(${index})`;
    }
    path = `${parent.tagName.toLowerCase()} > ${path}`;
    current = parent;
  }

  return path;
}

/**
 * Find alternative selectors based on failed selector
 * PERFORMANCE: Limited search to MAX_SEARCH elements per category
 * @param {string} failedSelector - The selector that didn't work
 * @returns {Array} Array of {selector, reason} alternatives
 */
function findSelectorAlternatives(failedSelector) {
  const alternatives = [];
  const MAX_SEARCH = 100; // Stop searching after 100 elements per category (performance)
  const MAX_ALTERNATIVES = 5;

  // Early exit if we have enough alternatives
  const hasEnough = () => alternatives.length >= MAX_ALTERNATIVES;

  // Extract potential text/ID hints from selector
  const idMatch = failedSelector.match(/#([a-zA-Z0-9_-]+)/);
  const textHints = [];

  // Look for text patterns
  const containsMatch = failedSelector.match(/:contains\(['"](.+?)['"]\)/i);
  if (containsMatch) textHints.push(containsMatch[1]);

  // Look for aria-label pattern
  const ariaMatch = failedSelector.match(/\[aria-label[*~|^$]?=['"](.+?)['"]\]/i);
  if (ariaMatch) textHints.push(ariaMatch[1]);

  // If it looks like an ID selector, try similar IDs
  if (idMatch && !hasEnough()) {
    const idValue = idMatch[1].toLowerCase();
    const allIds = Array.from(document.querySelectorAll('[id]')).slice(0, MAX_SEARCH);
    for (const el of allIds) {
      if (hasEnough()) break;
      if (el.id.toLowerCase().includes(idValue)) {
        alternatives.push({
          selector: `#${el.id}`,
          reason: `Similar ID found`
        });
      }
    }
  }

  // Try to find elements by text content (for buttons/links)
  const isButtonSelector = failedSelector.includes('button') || failedSelector.includes('btn');
  const isLinkSelector = failedSelector.includes('a[') || failedSelector.includes('link');

  if ((isButtonSelector || textHints.length > 0) && !hasEnough()) {
    const searchText = textHints[0]?.toLowerCase() || '';
    const allButtons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]')).slice(0, MAX_SEARCH);
    for (const el of allButtons) {
      if (hasEnough()) break;
      const btnText = (el.textContent || el.value || '').trim().toLowerCase();
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();

      if ((searchText && (btnText.includes(searchText) || ariaLabel.includes(searchText))) ||
          (isButtonSelector && btnText)) {
        const uniqueSelector = generateUniqueSelector(el);
        if (!alternatives.some(a => a.selector === uniqueSelector)) {
          alternatives.push({
            selector: uniqueSelector,
            reason: `Button: "${(el.textContent || el.value || '').trim().slice(0, 30)}"`
          });
        }
      }
    }
  }

  if ((isLinkSelector || textHints.length > 0) && !hasEnough()) {
    const searchText = textHints[0]?.toLowerCase() || '';
    const allLinks = Array.from(document.querySelectorAll('a[href]')).slice(0, MAX_SEARCH);
    for (const el of allLinks) {
      if (hasEnough()) break;
      const linkText = el.textContent.trim().toLowerCase();
      if (searchText && linkText.includes(searchText)) {
        const uniqueSelector = generateUniqueSelector(el);
        if (!alternatives.some(a => a.selector === uniqueSelector)) {
          alternatives.push({
            selector: uniqueSelector,
            reason: `Link: "${el.textContent.trim().slice(0, 30)}"`
          });
        }
      }
    }
  }

  // Try aria-label matching for any element
  if (textHints.length > 0 && !hasEnough()) {
    const searchText = textHints[0].toLowerCase();
    const allAriaLabeled = Array.from(document.querySelectorAll('[aria-label]')).slice(0, MAX_SEARCH);
    for (const el of allAriaLabeled) {
      if (hasEnough()) break;
      const ariaLabel = el.getAttribute('aria-label').toLowerCase();
      if (ariaLabel.includes(searchText)) {
        const uniqueSelector = generateUniqueSelector(el);
        if (!alternatives.some(a => a.selector === uniqueSelector)) {
          alternatives.push({
            selector: uniqueSelector,
            reason: `aria-label="${el.getAttribute('aria-label')}"`
          });
        }
      }
    }
  }

  return alternatives.slice(0, MAX_ALTERNATIVES);
}

/**
 * Build helpful error message with selector suggestions
 * @param {string} selector - Failed selector
 * @param {string} operation - Operation name (click, type, etc)
 * @returns {Error} Enhanced error with suggestions
 */
function buildElementNotFoundError(selector, operation) {
  const suggestions = findSelectorAlternatives(selector);

  let message = `Element not found: ${selector}`;

  if (suggestions.length > 0) {
    message += `\n\nSuggested alternatives:`;
    suggestions.forEach(sugg => {
      message += `\n  - ${sugg.selector} (${sugg.reason})`;
    });
  }

  // Add page context
  message += `\n\nPage context:`;
  message += `\n  URL: ${window.location.href}`;
  message += `\n  Title: ${document.title}`;

  // Check for iframe context
  if (window !== window.top) {
    message += `\n  Warning: Inside iframe - element may be in parent frame`;
  }

  // Add hint
  message += `\n\nHint: Use firefox_get_page_state() to see available elements.`;

  return new Error(message);
}

// ===== END AUTO-RETRY SYSTEM =====

/**
 * Resolve once any scroll in the page (window or an inner container) has
 * finished. Waits for `scrollend`, capped at maxMs; resolves early when no
 * scroll event starts within startTimeoutMs, i.e. the call moved nothing.
 * Scroll events do not bubble from elements, hence the capturing listeners.
 */
function waitForScrollEnd({ startTimeoutMs = 150, maxMs = 1000 } = {}) {
  return new Promise(resolve => {
    let started = false;
    let startTimer;
    let maxTimer;
    const finish = () => {
      clearTimeout(startTimer);
      clearTimeout(maxTimer);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('scrollend', finish, true);
      resolve();
    };
    const onScroll = () => {
      started = true;
      clearTimeout(startTimer);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('scrollend', finish, true);
    startTimer = setTimeout(() => { if (!started) finish(); }, startTimeoutMs);
    maxTimer = setTimeout(finish, maxMs);
  });
}

/**
 * Scroll to element or position
 * @param {object} params - Parameters
 * @param {string} params.selector - CSS selector to scroll to
 * @param {number} params.x - X position to scroll to
 * @param {number} params.y - Y position to scroll to
 * @param {string} params.behavior - 'instant' or 'smooth' (default: instant). Smooth
 *   scrolls are awaited so reported positions are final.
 * @returns {Promise<object>} Result
 */
async function scroll(params = {}) {
  const { selector, x, y, behavior = 'instant' } = params;
  const settled = behavior === 'smooth' ? waitForScrollEnd() : null;

  if (hasRef(params) || selector) {
    const element = resolveElement(params);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }
    // Show focusglow on scroll target
    moveFocusTo(element);
    element.scrollIntoView({ behavior, block: 'center' });
    if (settled) await settled;
    const rect = element.getBoundingClientRect();
    return {
      ...targetOf(params),
      scrolledTo: true,
      elementPosition: { x: rect.x, y: rect.y },
    };
  }

  if (x !== undefined || y !== undefined) {
    const beforeX = window.scrollX;
    const beforeY = window.scrollY;
    window.scrollTo({
      left: x ?? window.scrollX,
      top: y ?? window.scrollY,
      behavior,
    });
    if (settled) await settled;
    const afterX = window.scrollX;
    const afterY = window.scrollY;
    const noEffect = afterX === beforeX && afterY === beforeY;
    return {
      scrolledTo: true,
      noEffect,
      position: { x: afterX, y: afterY },
    };
  }

  // Return current scroll position
  if (settled) await settled;
  return {
    position: { x: window.scrollX, y: window.scrollY },
    pageHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
  };
}

/**
 * Wait for element to appear
 * @param {object} params - Parameters
 * @param {string} params.selector - CSS selector to wait for
 * @param {number} params.timeout - Timeout in ms (default: 10000)
 * @param {number} params.interval - Poll interval in ms (default: 100)
 * @returns {Promise<object>} Result
 */
async function waitFor(params) {
  const { selector, text, url, timeout = 10000, interval = 100 } = params;

  const startTime = Date.now();

  // text mode: wait for body text to include string
  if (text !== undefined) {
    while (Date.now() - startTime < timeout) {
      if (document.body && document.body.innerText.includes(text)) {
        return { text, found: true, elapsed: Date.now() - startTime };
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new Error(`Timeout waiting for text: "${text}"`);
  }

  // url mode: wait for location to match glob
  if (url !== undefined) {
    const globToRegex = g => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    const re = globToRegex(url);
    while (Date.now() - startTime < timeout) {
      if (re.test(window.location.href)) {
        return { url, matched: window.location.href, found: true, elapsed: Date.now() - startTime };
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new Error(`Timeout waiting for URL matching: "${url}"`);
  }

  // selector mode (default)
  // SECURITY: Validate selector before use
  validateSelector(selector);

  while (Date.now() - startTime < timeout) {
    const element = document.querySelector(selector);
    if (element) {
      const rect = element.getBoundingClientRect();
      return {
        selector,
        found: true,
        elapsed: Date.now() - startTime,
        visible: rect.width > 0 && rect.height > 0,
        position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(`Timeout waiting for element: ${selector}`);
}

/**
 * Check page readiness for screenshot (render settlement)
 * Uses double RAF + requestIdleCallback for precise timing
 * @param {object} params - Parameters (currently unused, reserved for future)
 * @returns {Promise<object>} Readiness result with timing info
 */
async function checkPageReadiness(params = {}) {
  const result = {
    readyState: document.readyState,
    timestamp: Date.now(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollY: window.scrollY
    }
  };

  // Wait for double RAF (ensures paint cycle complete)
  // Bounded: an unpainted tab never fires a frame, so each wait is capped
  const rafStart = performance.now();
  await nextFrame();
  await nextFrame();
  result.rafWaitMs = Math.round((performance.now() - rafStart) * 100) / 100;

  // Check for running animations
  if (typeof document.getAnimations === 'function') {
    const animations = document.getAnimations();
    result.runningAnimations = animations.filter(a => a.playState === 'running').length;
  }

  // Wait for idle callback if main thread is busy (with short timeout)
  if ('requestIdleCallback' in window) {
    const idleStart = performance.now();
    await new Promise(resolve => {
      requestIdleCallback(resolve, { timeout: 100 }); // Short timeout for responsiveness
    });
    result.idleWaitMs = Math.round((performance.now() - idleStart) * 100) / 100;
  }

  return result;
}

/**
 * SECURITY: Blocked expression patterns for evaluate()
 * These patterns could be used for exfiltration or dangerous operations
 */
const BLOCKED_EXPRESSION_PATTERNS = [
  /\bfetch\s*\(/i,           // fetch() - network exfiltration
  /\bXMLHttpRequest\b/i,     // XHR - network exfiltration
  /\bimport\s*\(/i,          // dynamic import
  /\beval\s*\(/i,            // nested eval
  /\bFunction\s*\(/i,        // Function constructor
  /\bsetTimeout\s*\(/i,      // async execution (can bypass detection)
  /\bsetInterval\s*\(/i,     // async execution
  /\bdocument\.cookie\b/i,   // cookie access
  /\blocalStorage\b/i,       // storage access (allowed in expression result, blocked in modification)
  /\bsessionStorage\b/i,     // storage access
];

/**
 * Evaluate JavaScript in page context
 * SECURITY: Expression is validated before execution to block dangerous patterns
 * @param {object} params - Parameters
 * @param {string} params.expression - JavaScript expression to evaluate
 * @returns {object} Result
 */
async function evaluate(params) {
  await ensureSettingsLoaded();

  const { expression } = params;

  if (!expression) {
    throw new Error('expression is required');
  }

  // SECURITY: firefox_evaluate is disabled by default. Users must opt in via the
  // popup toggle (sets claudezilla.allowEvaluate = true in browser.storage.local).
  // This gate is documented in SECURITY.md for AMO reviewers.
  if (!settings.allowEvaluate) {
    throw new Error('firefox_evaluate is disabled. Enable it from the Claudezilla popup (Settings → Allow JavaScript evaluation).');
  }

  // SECURITY: Limit expression length to prevent DoS
  if (expression.length > 10000) {
    throw new Error('Expression too long (max 10000 characters)');
  }

  // SECURITY: Block dangerous patterns
  for (const pattern of BLOCKED_EXPRESSION_PATTERNS) {
    if (pattern.test(expression)) {
      throw new Error(`Blocked expression pattern detected: ${pattern.source.slice(0, 20)}...`);
    }
  }

  try {
    // Use Function constructor for safer eval (page-isolated)
    const result = new Function(`return (${expression})`)();

    // Serialize result
    let serialized;
    try {
      serialized = JSON.parse(JSON.stringify(result));
    } catch (e) {
      serialized = String(result);
    }

    return {
      expression,
      result: serialized,
      type: typeof result,
    };
  } catch (error) {
    return {
      expression,
      error: error.message,
      type: 'error',
    };
  }
}

/**
 * Get element info (attributes, styles, visibility)
 * @param {object} params - Parameters
 * @param {string} params.selector - CSS selector
 * @returns {object} Element info
 */
function getElementInfo(params) {
  const element = resolveElement(params);
  if (!element) {
    throw new Error(`Element not found: ${params.selector}`);
  }

  // Show focusglow on inspected element
  moveFocusTo(element);

  const rect = element.getBoundingClientRect();
  const styles = window.getComputedStyle(element);

  // Get all attributes
  const attributes = {};
  for (const attr of element.attributes) {
    attributes[attr.name] = attr.value;
  }

  return {
    ...targetOf(params),
    tagName: element.tagName.toLowerCase(),
    attributes,
    text: element.textContent?.trim().slice(0, 500),
    visible: rect.width > 0 && rect.height > 0 && styles.display !== 'none' && styles.visibility !== 'hidden',
    position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    styles: {
      display: styles.display,
      visibility: styles.visibility,
      opacity: styles.opacity,
      color: styles.color,
      backgroundColor: styles.backgroundColor,
      fontSize: styles.fontSize,
    },
  };
}

/**
 * Get the visible text of the page or of one element, one page at a time
 * @param {object} params - Parameters
 * @param {string} params.ref - Optional element ref to read
 * @param {string} params.selector - Optional CSS selector to read
 * @param {boolean} params.includeHtml - Include HTML in response (default: false)
 * @param {number} params.offset - Character offset to start from (default: 0)
 * @param {number} params.maxLength - Max characters returned (default: 20000)
 * @returns {object} { url, title, offset, textLength, truncated, nextOffset?, text, html? }
 */
function getContent(params = {}) {
  const { selector, includeHtml = false } = params;
  const offset = Math.max(0, Math.floor(Number(params.offset) || 0));
  const maxLength = Math.max(1, Math.floor(Number(params.maxLength) || 20000));

  let scope = document.body;
  if (hasRef(params) || selector) {
    scope = resolveElement(params);
    if (!scope) {
      throw new Error(`Element not found: ${selector}`);
    }
    // Show focusglow on read element
    moveFocusTo(scope);
  }

  // innerText is the rendered text: no script/style contents, hidden text excluded
  const fullText = scope?.innerText ?? '';
  const end = offset + maxLength;
  const truncated = end < fullText.length;

  const result = {
    url: window.location.href,
    title: document.title,
    offset,
    textLength: fullText.length,
    truncated,
    ...(truncated ? { nextOffset: end } : {}),
    text: fullText.slice(offset, end),
  };
  if (includeHtml) {
    result.html = scope === document.body ? document.documentElement.outerHTML : scope.innerHTML;
  }
  return result;
}

/**
 * Click an element (with smart auto-wait)
 * @param {object} params - Parameters
 * @param {string} params.selector - CSS selector for element to click
 * @param {boolean} params.autoWait - Whether to auto-wait for element (default: true)
 * @param {number} params.waitTimeout - Max time to wait for element in ms (default: 5000)
 * @returns {Promise<object>} Result
 */
async function click(params) {
  const { selector, autoWait = true, waitTimeout = RETRY_CONFIG.autoWaitTimeout } = params;

  // ref resolves immediately; a selector auto-waits for the element
  const element = await resolveElement(params, { autoWait, timeout: waitTimeout });
  if (!element) {
    throw buildElementNotFoundError(selector, 'click');
  }

  // Show focusglow on clicked element
  moveFocusTo(element);

  // Scroll element into view
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Wait for the smooth scroll to finish before aiming the click
  await waitForStableRect(element);

  // Full pointer/mouse sequence, not a lone click event (pointer-click.js)
  const dispatch = dispatchPointerClick(element);

  return {
    ...targetOf(params),
    clicked: true,
    method: dispatch.method,
    trusted: dispatch.trusted,
    x: dispatch.x,
    y: dispatch.y,
    target: dispatch.target,
    obscuredBy: dispatch.obscuredBy,
    defaultPrevented: dispatch.defaultPrevented,
    tagName: element.tagName.toLowerCase(),
    text: element.textContent?.trim().slice(0, 100) || '',
    id: element.id || null,
    className: element.className || null,
  };
}

/**
 * Type text into an input element (with smart auto-wait)
 * @param {object} params - Parameters
 * @param {string} params.selector - CSS selector for input element
 * @param {string} params.text - Text to type
 * @param {boolean} params.clear - Whether to clear existing value first
 * @param {boolean} params.autoWait - Whether to auto-wait for element (default: true)
 * @param {number} params.waitTimeout - Max time to wait for element in ms (default: 5000)
 * @returns {Promise<object>} Result
 */
async function type(params) {
  const { selector, text, clear = true, autoWait = true, waitTimeout = RETRY_CONFIG.autoWaitTimeout } = params;

  if (text === undefined) {
    throw new Error('text is required');
  }

  // ref resolves immediately; a selector auto-waits for the element
  const element = await resolveElement(params, { autoWait, timeout: waitTimeout });
  if (!element) {
    throw buildElementNotFoundError(selector, 'type');
  }

  // Check if element is an input or textarea
  const isInput = element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';
  const isContentEditable = element.isContentEditable;

  if (!isInput && !isContentEditable) {
    throw new Error(`Element is not editable: ${params.ref ?? selector}`);
  }

  // Show focusglow on input element
  moveFocusTo(element);

  // Focus the element
  element.focus();

  if (isInput) {
    // Use native setter for React/Angular compatibility
    // React overrides value setter, so direct assignment bypasses change detection
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set;
    const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    ).set;

    const setter = element.tagName === 'TEXTAREA'
      ? nativeTextareaValueSetter
      : nativeInputValueSetter;

    const newValue = clear ? text : element.value + text;
    setter.call(element, newValue);

    // Dispatch InputEvent (more specific than generic Event, better framework compat)
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text
    }));
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
    ...targetOf(params),
    typed: text,
    currentValue: isInput ? element.value : element.textContent,
  };
}

/**
 * Get structured page state (fast alternative to screenshots)
 * @param {object} params - Parameters
 * @param {number} params.maxHeadings - Max headings to return (default: 30)
 * @param {number} params.maxLinks - Max links to return (default: 50)
 * @param {number} params.maxButtons - Max buttons to return (default: 30)
 * @param {number} params.maxInputs - Max inputs to return (default: 30)
 * @param {number} params.maxImages - Max images to return (default: 20)
 * @returns {object} Page state
 */
function getPageState(params = {}) {
  const {
    maxHeadings = 30,
    maxLinks = 50,
    maxButtons = 30,
    maxInputs = 30,
    maxImages = 20,
  } = params;

  // Collect all items first, then slice
  const allHeadings = [];
  const allLinks = [];
  const allButtons = [];
  const allInputs = [];
  const allImages = [];
  const allLandmarks = [];

  // Headings (truncate text at 100 chars, flag if truncated)
  document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(el => {
    const text = el.textContent?.trim();
    if (text) {
      const isTruncated = text.length > 100;
      allHeadings.push({
        ref: refFor(el),
        level: el.tagName.toLowerCase(),
        text: text.slice(0, 100),
        ...(isTruncated ? { truncated: true, rawLength: text.length } : {}),
      });
    }
  });

  // Links (visible, with text; text capped at 50, href at 100)
  document.querySelectorAll('a[href]').forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const text = el.textContent?.trim() || el.getAttribute('aria-label') || '';
      if (text) {
        const rawHref = el.getAttribute('href') || '';
        const isTruncated = text.length > 50 || rawHref.length > 100;
        allLinks.push({
          ref: refFor(el),
          text: text.slice(0, 50),
          href: rawHref.slice(0, 100),
          ...(isTruncated ? { truncated: true } : {}),
        });
      }
    }
  });

  // Buttons (text capped at 50)
  document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const rawText = el.textContent?.trim() || el.value || el.getAttribute('aria-label') || '';
      const isTruncated = rawText.length > 50;
      allButtons.push({
        ref: refFor(el),
        text: rawText.slice(0, 50),
        disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
        type: el.type || 'button',
        ...(isTruncated ? { truncated: true } : {}),
      });
    }
  });

  // Form inputs (non-password value capped at 50; password always masked as '***' without leak)
  document.querySelectorAll('input, textarea, select').forEach(el => {
    if (el.type === 'hidden') return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const isPassword = el.type === 'password';
      const rawVal = el.value || '';
      const isTruncated = !isPassword && rawVal.length > 50;
      allInputs.push({
        ref: refFor(el),
        type: el.type || el.tagName.toLowerCase(),
        name: el.name || el.id || '',
        label: el.getAttribute('aria-label') || el.placeholder || document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() || '',
        value: isPassword ? '***' : rawVal.slice(0, 50),
        required: el.required,
        disabled: el.disabled,
        ...(isTruncated ? { truncated: true } : {}),
      });
    }
  });

  // Images with alt text (alt capped at 100, src at 100)
  document.querySelectorAll('img[alt]').forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width > 20 && rect.height > 20) {
      const rawAlt = el.alt || '';
      const rawSrc = el.src || '';
      const isTruncated = rawAlt.length > 100 || rawSrc.length > 100;
      allImages.push({
        alt: rawAlt.slice(0, 100),
        src: rawSrc.slice(0, 100),
        ...(isTruncated ? { truncated: true } : {}),
      });
    }
  });

  // ARIA landmarks
  document.querySelectorAll('[role="main"], [role="navigation"], [role="banner"], [role="contentinfo"], [role="search"], [role="form"], main, nav, header, footer, aside').forEach(el => {
    allLandmarks.push({
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      label: el.getAttribute('aria-label') || '',
    });
  });

  return {
    url: window.location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
    },
    errors: capturedLogs.filter(l => l.level === 'error').slice(-10).map(l => l.message),
    headings: allHeadings.slice(0, maxHeadings),
    links: allLinks.slice(0, maxLinks),
    buttons: allButtons.slice(0, maxButtons),
    inputs: allInputs.slice(0, maxInputs),
    images: allImages.slice(0, maxImages),
    landmarks: allLandmarks,
    counts: {
      headings: { shown: Math.min(allHeadings.length, maxHeadings), total: allHeadings.length },
      links: { shown: Math.min(allLinks.length, maxLinks), total: allLinks.length },
      buttons: { shown: Math.min(allButtons.length, maxButtons), total: allButtons.length },
      inputs: { shown: Math.min(allInputs.length, maxInputs), total: allInputs.length },
      images: { shown: Math.min(allImages.length, maxImages), total: allImages.length },
      landmarks: { shown: allLandmarks.length, total: allLandmarks.length },
    },
  };
}

// ===== ACCESSIBILITY HELPERS (snapshot, find) =====

// Roles whose accessible name comes from their text content
const NAME_FROM_CONTENT_ROLES = new Set([
  'button', 'link', 'heading', 'tab', 'menuitem', 'option', 'switch', 'treeitem', 'checkbox', 'radio',
]);
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'option', 'switch', 'combobox', 'textbox',
  'searchbox', 'slider',
]);
// Ancestors that give a find match its context
const CONTEXT_ROLES = new Set([
  'main', 'navigation', 'banner', 'contentinfo', 'complementary', 'form', 'search', 'region', 'dialog', 'heading',
]);

function collapseWhitespace(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function getRole(el) {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;

  // Implicit roles
  const tag = el.tagName.toLowerCase();
  const roleMap = {
    'a': el.href ? 'link' : null,
    'button': 'button',
    'input': el.type === 'checkbox' ? 'checkbox' : el.type === 'radio' ? 'radio' : el.type === 'submit' ? 'button' : 'textbox',
    'select': 'combobox',
    'textarea': 'textbox',
    'img': 'img',
    'nav': 'navigation',
    'main': 'main',
    'header': 'banner',
    'footer': 'contentinfo',
    'aside': 'complementary',
    'form': 'form',
    'table': 'table',
    'ul': 'list',
    'ol': 'list',
    'li': 'listitem',
    'h1': 'heading',
    'h2': 'heading',
    'h3': 'heading',
    'h4': 'heading',
    'h5': 'heading',
    'h6': 'heading',
  };
  return roleMap[tag] || null;
}

/**
 * Accessible name: explicit labels first, then text content for roles named
 * by their content (buttons, links, headings, ...). Capped at 100 chars.
 */
function getAccessibleName(el, role = getRole(el)) {
  const labelledBy = el.getAttribute('aria-labelledby');
  const explicit = el.getAttribute('aria-label') ||
    (labelledBy && document.getElementById(labelledBy)?.textContent?.trim()) ||
    el.getAttribute('title') ||
    el.getAttribute('alt') ||
    (el.tagName === 'INPUT' && el.placeholder) ||
    (el.labels?.[0]?.textContent?.trim()) ||
    '';
  if (explicit) return collapseWhitespace(explicit).slice(0, 100);
  if (role && NAME_FROM_CONTENT_ROLES.has(role)) return collapseWhitespace(el.textContent).slice(0, 100);
  return '';
}

/** The element's own text: its direct text-node children, not descendants' text. */
function directText(el) {
  let text = '';
  for (const node of el.childNodes) {
    if (node.nodeType === 3) text += node.textContent;
  }
  return collapseWhitespace(text);
}

/** One getComputedStyle call per element. */
function layoutOf(el) {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return {
    rect,
    visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
  };
}

function isOffscreen(rect) {
  return rect.top + rect.height <= 0 || rect.top >= window.innerHeight ||
         rect.left + rect.width <= 0 || rect.left >= window.innerWidth;
}

/**
 * Whether the user can act on the element (click, type, toggle).
 * @param {Element} el
 * @returns {boolean}
 */
function isInteractive(el) {
  const tag = el.tagName;
  if (tag === 'A' && el.getAttribute('href') !== null) return true;
  if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'SUMMARY') return true;
  if (tag === 'INPUT' && String(el.type || '').toLowerCase() !== 'hidden') return true;
  const role = el.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  const editable = el.getAttribute('contenteditable');
  if (editable === '' || editable === 'true') return true;
  const tabindex = el.getAttribute('tabindex');
  return tabindex !== null && tabindex.trim() !== '' && Number(tabindex) >= 0;
}

/** Form field value safe to show (never passwords, not for toggles/buttons). */
function fieldValue(el) {
  if (!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return '';
  if (/^(password|checkbox|radio|submit|button|reset|image|file)$/i.test(el.type || '')) return '';
  return el.value ? String(el.value).slice(0, 50) : '';
}

/** Link target with a same-origin prefix stripped, capped at 100 chars. */
function shortHref(el) {
  const href = typeof el.href === 'string' ? el.href : (el.getAttribute('href') || '');
  const origin = window.location.origin;
  const short = origin && href.startsWith(`${origin}/`) ? href.slice(origin.length) : href;
  return short.slice(0, 100);
}

function stateTokens(el, role, rect) {
  const tokens = [];
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') tokens.push('disabled');
  if (el.checked || el.getAttribute('aria-checked') === 'true') tokens.push('checked');
  const expanded = el.getAttribute('aria-expanded');
  if (expanded === 'true') tokens.push('expanded');
  else if (expanded === 'false') tokens.push('collapsed');
  if (el.getAttribute('aria-selected') === 'true' || (el.tagName === 'OPTION' && el.selected)) tokens.push('selected');
  if (role === 'heading') {
    const level = el.getAttribute('aria-level') || /^H([1-6])$/i.exec(el.tagName)?.[1];
    if (level) tokens.push(`level=${level}`);
  }
  if (role === 'link') {
    const href = shortHref(el);
    if (href) tokens.push(`href=${href}`);
  }
  const value = fieldValue(el);
  if (value) tokens.push(`value=${JSON.stringify(value)}`);
  if (isOffscreen(rect)) tokens.push('offscreen');
  return tokens;
}

/**
 * Get accessibility tree snapshot
 * @param {object} params - Parameters
 * @param {string} params.format - 'text' (default): one line per node with [ref_N]; 'json': nested tree
 * @param {string} params.filter - 'all' (default) or 'interactive' (flat list of actionable elements)
 * @param {number} params.maxDepth - Max tree depth (default: 15)
 * @param {number} params.maxNodes - Max nodes to include (default: 200, cap 2000)
 * @param {string} params.ref - Root element ref (default: body)
 * @param {string} params.selector - Root element selector (default: body)
 * @returns {object} Snapshot: text lines, or a JSON tree (filter=all) / node list (filter=interactive)
 */
function getAccessibilitySnapshot(params = {}) {
  const { format = 'text', filter = 'all', maxDepth = 15 } = params;
  const maxNodes = Math.min(Math.max(1, Number(params.maxNodes) || 200), 2000);
  if (format !== 'text' && format !== 'json') throw new Error('format must be "text" or "json"');
  if (filter !== 'all' && filter !== 'interactive') throw new Error('filter must be "all" or "interactive"');

  let root = document.body;
  if (hasRef(params) || params.selector) {
    root = resolveElement(params);
    if (!root) throw new Error(`Element not found: ${params.selector}`);
  }

  let nodeCount = 0;
  let truncated = false;

  function describe(el, rect, depth) {
    const role = getRole(el);
    const name = getAccessibleName(el, role);
    const own = directText(el).slice(0, 100);
    return { el, rect, depth, role, name, text: own !== name ? own : '', children: [] };
  }

  // Tree walk: returns the emitted nodes for el (wrappers yield their children)
  function walk(el, depth) {
    if (depth > maxDepth) return [];
    if (nodeCount >= maxNodes) {
      truncated = true;
      return [];
    }
    const { rect, visible } = layoutOf(el);
    if (!visible && el !== root) return [];

    const node = describe(el, rect, depth);
    // Skip non-semantic wrappers without accessible info, keeping their children
    if (el !== root && !node.role && !node.name && !node.text && /^(DIV|SPAN|P)$/i.test(el.tagName)) {
      return walkChildren(el, depth);
    }
    nodeCount++;
    node.children = walkChildren(el, depth + 1);
    return [node];
  }

  function walkChildren(el, depth) {
    const out = [];
    for (const child of el.children) out.push(...walk(child, depth));
    return out;
  }

  // Interactive walk: visible actionable elements in DOM order, flat
  function collectInteractive(el, out) {
    if (truncated) return;
    const { rect, visible } = layoutOf(el);
    if (!visible && el !== root) return;
    if (isInteractive(el)) {
      if (nodeCount >= maxNodes) {
        truncated = true;
        return;
      }
      nodeCount++;
      out.push(describe(el, rect, 0));
    }
    for (const child of el.children) collectInteractive(child, out);
  }

  let nodes;
  if (filter === 'interactive') {
    nodes = [];
    collectInteractive(root, nodes);
  } else {
    nodes = walk(root, 0);
  }

  const url = window.location.href;
  const title = document.title;

  if (format === 'json') {
    const toJson = (node) => {
      const { el } = node;
      const out = { ref: refFor(el) };
      if (node.role) out.role = node.role;
      if (node.name) out.name = node.name;
      if (node.text) out.text = node.text;
      if (el.disabled) out.disabled = true;
      if (el.checked) out.checked = true;
      if (el.getAttribute('aria-expanded')) out.expanded = el.getAttribute('aria-expanded') === 'true';
      if (el.getAttribute('aria-selected')) out.selected = el.getAttribute('aria-selected') === 'true';
      const value = fieldValue(el);
      if (value) out.value = value;
      if (node.children.length > 0) out.children = node.children.map(toJson);
      return out;
    };
    const result = { url, title, format: 'json', nodeCount, maxNodes, truncated };
    if (filter === 'interactive') result.nodes = nodes.map(toJson);
    else result.tree = nodes[0] ? toJson(nodes[0]) : null;
    return result;
  }

  const lines = [`url: ${url}`, `title: ${title}`];
  const emit = (node) => {
    let line = `${'  '.repeat(node.depth)}- ${node.role ?? node.el.tagName.toLowerCase()}`;
    if (node.name) line += ` ${JSON.stringify(node.name)}`;
    if (node.text) line += `: ${JSON.stringify(node.text)}`;
    line += ` [${refFor(node.el)}]`;
    const states = stateTokens(node.el, node.role, node.rect);
    if (states.length > 0) line += ` ${states.join(' ')}`;
    lines.push(line);
    node.children.forEach(emit);
  };
  nodes.forEach(emit);
  if (truncated) {
    lines.push(`[truncated at ${maxNodes} nodes: pass ref to read a subtree or raise maxNodes]`);
  }

  return { url, title, format: 'text', nodeCount, truncated, text: lines.join('\n') };
}

/** Up to 80 chars of s around the match. */
function matchSnippet(s, { index, length }) {
  if (s.length <= 80) return s;
  const lead = Math.floor((80 - Math.min(length, 80)) / 2);
  const start = Math.max(0, Math.min(index - lead, s.length - 80));
  return s.slice(start, start + 80);
}

/**
 * Find visible elements by accessible name or own text.
 * @param {object} params - Parameters
 * @param {string} params.query - Text to find (case-insensitive substring, max 200 chars)
 * @param {boolean} params.regex - Treat query as a case-insensitive regular expression
 * @param {number} params.maxResults - Max matches listed (default: 20)
 * @returns {object} { query, total, truncated, text } with one [ref_N] line per match
 */
function findElements(params = {}) {
  const { query, regex = false } = params;
  const maxResults = Math.max(1, Number(params.maxResults) || 20);
  if (typeof query !== 'string' || query.length === 0) throw new Error('query is required');
  if (query.length > 200) throw new Error('query too long (max 200 characters)');

  let test;
  if (regex) {
    let re;
    try {
      re = new RegExp(query, 'i');
    } catch (e) {
      throw new Error(`Invalid regex: ${e.message}`);
    }
    test = (s) => {
      const m = re.exec(s);
      return m ? { index: m.index, length: m[0].length } : null;
    };
  } else {
    const needle = query.toLowerCase();
    test = (s) => {
      const index = s.toLowerCase().indexOf(needle);
      return index >= 0 ? { index, length: needle.length } : null;
    };
  }

  const matches = [];
  const context = [];
  let total = 0;

  // insideMatch: an ancestor already matched, so own-text hits here would only
  // repeat it (a link's name already includes its spans' text)
  function visit(el, insideMatch) {
    const { rect, visible } = layoutOf(el);
    if (!visible) return;
    const role = getRole(el);
    const name = getAccessibleName(el, role);
    const nameHit = name ? test(name) : null;
    const own = nameHit || insideMatch ? '' : directText(el);
    const textHit = own ? test(own) : null;
    const matched = Boolean(nameHit || textHit);
    if (matched) {
      total++;
      if (matches.length < maxResults) {
        matches.push({
          ref: refFor(el),
          role: role ?? el.tagName.toLowerCase(),
          name,
          text: nameHit ? matchSnippet(name, nameHit) : matchSnippet(own, textHit),
          context: context.slice(-3).join(' > '),
          offscreen: isOffscreen(rect),
        });
      }
    }
    const label = role && CONTEXT_ROLES.has(role) ? `${role}${name ? ` ${JSON.stringify(name)}` : ''}` : '';
    if (label) context.push(label);
    for (const child of el.children) visit(child, insideMatch || matched);
    if (label) context.pop();
  }
  for (const child of document.body.children) visit(child, false);

  const lines = matches.map((m) => {
    let line = `[${m.ref}] ${m.role}`;
    if (m.name) line += ` ${JSON.stringify(m.name)}`;
    if (m.text && m.text !== m.name) line += `: ${JSON.stringify(m.text)}`;
    if (m.context) line += ` — ${m.context}`;
    if (m.offscreen) line += ' offscreen';
    return line;
  });

  return {
    query,
    total,
    truncated: total > maxResults,
    text: lines.length > 0 ? lines.join('\n') : `No visible element matches ${JSON.stringify(query)}`,
  };
}

/**
 * Send keyboard event to element or document
 * @param {object} params - Parameters
 * @param {string} params.key - Key to press (e.g., 'Enter', 'Tab', 'Escape', 'a', 'ArrowDown')
 * @param {string} params.selector - Optional CSS selector for target element (default: active element)
 * @param {boolean} params.ctrlKey - Hold Ctrl/Cmd
 * @param {boolean} params.shiftKey - Hold Shift
 * @param {boolean} params.altKey - Hold Alt
 * @param {boolean} params.metaKey - Hold Meta (Cmd on Mac)
 * @returns {object} Result
 */
function pressKey(params) {
  const {
    key,
    ref,
    selector,
    ctrlKey = false,
    shiftKey = false,
    altKey = false,
    metaKey = false,
  } = params;

  if (!key) {
    throw new Error('key is required');
  }

  // Get target element
  let target;
  if (hasRef(params) || selector) {
    target = resolveElement(params);
    if (!target) {
      throw new Error(`Element not found: ${selector}`);
    }
    target.focus();
    moveFocusTo(target);
  } else {
    target = document.activeElement || document.body;
  }

  // Create and dispatch keyboard events
  const eventInit = {
    key,
    code: getKeyCode(key),
    keyCode: getKeyCodeNum(key),
    which: getKeyCodeNum(key),
    ctrlKey,
    shiftKey,
    altKey,
    metaKey,
    bubbles: true,
    cancelable: true,
  };

  const keydownEvent = new KeyboardEvent('keydown', eventInit);
  const keypressEvent = new KeyboardEvent('keypress', eventInit);
  const keyupEvent = new KeyboardEvent('keyup', eventInit);

  target.dispatchEvent(keydownEvent);
  // keypress is deprecated but some sites still use it
  if (key.length === 1) {
    target.dispatchEvent(keypressEvent);
  }
  target.dispatchEvent(keyupEvent);

  return {
    key,
    ...(hasRef(params) ? { ref } : { selector: selector || '(active element)' }),
    targetTag: target.tagName.toLowerCase(),
    modifiers: { ctrlKey, shiftKey, altKey, metaKey },
  };
}

/**
 * Get key code string for common keys
 */
function getKeyCode(key) {
  const codeMap = {
    'Enter': 'Enter',
    'Tab': 'Tab',
    'Escape': 'Escape',
    'Backspace': 'Backspace',
    'Delete': 'Delete',
    'ArrowUp': 'ArrowUp',
    'ArrowDown': 'ArrowDown',
    'ArrowLeft': 'ArrowLeft',
    'ArrowRight': 'ArrowRight',
    'Home': 'Home',
    'End': 'End',
    'PageUp': 'PageUp',
    'PageDown': 'PageDown',
    ' ': 'Space',
  };
  return codeMap[key] || (key.length === 1 ? `Key${key.toUpperCase()}` : key);
}

/**
 * Get numeric key code for common keys
 */
function getKeyCodeNum(key) {
  const numMap = {
    'Enter': 13,
    'Tab': 9,
    'Escape': 27,
    'Backspace': 8,
    'Delete': 46,
    'ArrowUp': 38,
    'ArrowDown': 40,
    'ArrowLeft': 37,
    'ArrowRight': 39,
    'Home': 36,
    'End': 35,
    'PageUp': 33,
    'PageDown': 34,
    ' ': 32,
  };
  if (numMap[key]) return numMap[key];
  if (key.length === 1) return key.toUpperCase().charCodeAt(0);
  return 0;
}

/**
 * Resize image using canvas (for screenshot compression)
 * @param {object} params - Parameters
 * @param {string} params.dataUrl - Source image data URL
 * @param {number} params.scale - Scale factor (0.25, 0.5, etc)
 * @param {number} params.quality - JPEG quality (1-100)
 * @param {string} params.format - Output format (jpeg/png)
 * @returns {Promise<object>} Resized image data
 */
async function resizeImage(params) {
  const { dataUrl, scale = 0.5, quality = 60, format = 'jpeg' } = params;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const originalWidth = img.width;
      const originalHeight = img.height;
      const newWidth = Math.round(originalWidth * scale);
      const newHeight = Math.round(originalHeight * scale);

      const canvas = document.createElement('canvas');
      canvas.width = newWidth;
      canvas.height = newHeight;

      const ctx = canvas.getContext('2d');
      // Use better quality scaling
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, newWidth, newHeight);

      const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
      const outputDataUrl = canvas.toDataURL(mimeType, quality / 100);

      resolve({
        dataUrl: outputDataUrl,
        originalSize: { width: originalWidth, height: originalHeight },
        scaledSize: { width: newWidth, height: newHeight },
      });
    };
    img.onerror = () => reject(new Error('Failed to load image for resizing'));
    img.src = dataUrl;
  });
}

/**
 * Annotate interactive elements with numbered badges for vision models
 * Uses Shadow DOM to avoid polluting page CSS
 * @param {object} params
 * @param {number} params.maxElements - Max elements to annotate (default: 30)
 * @returns {{labels: object, count: number}} labels map {index: {selector, text, role}} + count
 */
function annotateElements(params = {}) {
  const { maxElements = 30 } = params;
  const SELECTORS = ['button', 'a[href]', 'input', 'select', 'textarea', '[role="button"]', '[role="link"]'];
  const seen = new Set();
  const elements = [];

  for (const sel of SELECTORS) {
    for (const el of document.querySelectorAll(sel)) {
      if (!seen.has(el) && elements.length < maxElements) {
        seen.add(el);
        elements.push(el);
      }
    }
  }

  const labels = {};
  const host = document.createElement('div');
  host.id = '__clz_annotations__';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'closed' });

  elements.forEach((el, i) => {
    const idx = i + 1;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const badge = document.createElement('div');
    badge.textContent = String(idx);
    Object.assign(badge.style, {
      position: 'fixed',
      top: `${rect.top + window.scrollY - 9}px`,
      left: `${rect.left + window.scrollX - 9}px`,
      background: '#e53e3e',
      color: '#fff',
      borderRadius: '50%',
      width: '18px',
      height: '18px',
      fontSize: '11px',
      fontWeight: 'bold',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '2147483647',
      pointerEvents: 'none',
      fontFamily: 'monospace',
      lineHeight: '1',
    });
    shadow.appendChild(badge);

    // Build a reasonable selector for the element
    let selector = el.tagName.toLowerCase();
    if (el.id) selector = `#${el.id}`;
    else if (el.className && typeof el.className === 'string') selector += '.' + el.className.trim().split(/\s+/).join('.');

    labels[String(idx)] = {
      selector,
      text: (el.textContent || el.value || el.placeholder || el.getAttribute('aria-label') || '').trim().slice(0, 80),
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
    };
  });

  return { labels, count: Object.keys(labels).length };
}

/**
 * Remove annotation badges injected by annotateElements
 */
function removeAnnotations() {
  const host = document.getElementById('__clz_annotations__');
  if (host) host.remove();
  return { removed: true };
}

/**
 * Detect and dismiss GDPR/cookie consent overlays
 * 4-pass detection: CMP selectors → text matching → shadow DOM → ARIA dialogs
 */
async function handleConsent(params = {}) {
  const { scanTimeout = 3000 } = params;
  const startTime = Date.now();

  // Visibility check helper (mirrors walkTree pattern from getAccessibilitySnapshot)
  function isConsentVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 &&
           window.getComputedStyle(el).display !== 'none' &&
           window.getComputedStyle(el).visibility !== 'hidden';
  }

  // Click mechanics (reuse pattern from click() function)
  async function clickElement(el, buttonText, method = 'cmp-selector') {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await waitForStableRect(el);
    dispatchPointerClick(el);
    return { found: true, clicked: true, buttonText, method, elapsed: Date.now() - startTime };
  }

  function timeoutGuard() {
    return Date.now() - startTime < scanTimeout;
  }

  // Known CMP selectors (Google, OneTrust, Cookiebot, Didomi, Quantcast, etc.)
  const CMP_SELECTORS = [
    // Google consent.google.com
    '#L2AGLb',
    '.fc-consent-root button[aria-label="Accept all"]',
    // OneTrust
    '#onetrust-accept-btn-handler',
    '#accept-recommended-btn-handler',
    // Quantcast
    '.qc-cmp2-summary-buttons button:first-child',
    // Didomi
    '#didomi-notice-agree-button',
    // Cookiebot
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    // Generic patterns
    '[id*="accept"][id*="cookie"]',
    '[id*="consent"][id*="accept"]',
    '[class*="accept-all"]',
    '[class*="consent-accept"]',
  ];

  // ===== PASS 1: CMP-specific selectors =====
  if (timeoutGuard()) {
    for (const selector of CMP_SELECTORS) {
      if (!timeoutGuard()) break;
      try {
        const el = document.querySelector(selector);
        if (el && isConsentVisible(el)) {
          return await clickElement(el, el.textContent?.trim().slice(0, 50) || '');
        }
      } catch {
        // Invalid selector — skip silently
      }
    }
  }

  // ===== PASS 2: Text matching on buttons =====
  if (timeoutGuard()) {
    const ACCEPT_PATTERNS = [
      /^i agree$/,
      /^accept all$/,
      /^accept all cookies$/,
      /^allow all$/,
      /^allow all cookies$/,
      /^agree$/,
      /^got it$/,
      /^consent$/,
    ];
    const REJECT_GUARD = /\b(reject|decline|refuse|deny|no thanks)\b/i;

    // Button selector base (mirrors getPageState line 1445)
    const buttons = document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]');
    for (const btn of buttons) {
      if (!timeoutGuard()) break;

      // Get button text from textContent or aria-label
      const textContent = (btn.textContent?.trim() || btn.getAttribute('aria-label') || '').toLowerCase();
      if (!textContent) continue;

      // Check if text matches an accept pattern
      const matches = ACCEPT_PATTERNS.some(pat => pat.test(textContent));
      if (matches && !REJECT_GUARD.test(textContent) && isConsentVisible(btn)) {
        return await clickElement(btn, (btn.textContent?.trim() || btn.getAttribute('aria-label') || '').slice(0, 50), 'text-match');
      }
    }
  }

  // ===== PASS 3: Shadow DOM shallow traversal =====
  if (timeoutGuard()) {
    // Likely shadow root hosts
    const shadowHosts = document.querySelectorAll(
      'div[id*="consent"], div[id*="cookie"], div[class*="consent"], ' +
      'div[class*="cookie"], section[id*="consent"], #usercentrics-root'
    );

    for (const host of shadowHosts) {
      if (!timeoutGuard()) break;
      if (!host.shadowRoot) continue; // Closed-mode shadow roots return null — skip silently

      // Re-run CMP selectors inside shadowRoot
      for (const selector of CMP_SELECTORS) {
        if (!timeoutGuard()) break;
        try {
          const el = host.shadowRoot.querySelector(selector);
          if (el && isConsentVisible(el)) {
            return await clickElement(el, el.textContent?.trim().slice(0, 50) || '', 'shadow-dom');
          }
        } catch {
          // Skip invalid selectors
        }
      }

      // Re-run text matching inside shadowRoot
      const ACCEPT_PATTERNS = [
        /^i agree$/,
        /^accept all$/,
        /^accept all cookies$/,
        /^allow all$/,
        /^allow all cookies$/,
        /^agree$/,
        /^got it$/,
        /^consent$/,
      ];
      const REJECT_GUARD = /\b(reject|decline|refuse|deny|no thanks)\b/i;

      const buttons = host.shadowRoot.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]');
      for (const btn of buttons) {
        if (!timeoutGuard()) break;

        const textContent = (btn.textContent?.trim() || btn.getAttribute('aria-label') || '').toLowerCase();
        if (!textContent) continue;

        const matches = ACCEPT_PATTERNS.some(pat => pat.test(textContent));
        if (matches && !REJECT_GUARD.test(textContent) && isConsentVisible(btn)) {
          return await clickElement(btn, (btn.textContent?.trim() || btn.getAttribute('aria-label') || '').slice(0, 50), 'shadow-dom');
        }
      }
    }
  }

  // ===== PASS 4: ARIA dialog fallback =====
  if (timeoutGuard()) {
    const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
    const ACCEPT_PATTERNS = [
      /^i agree$/,
      /^accept all$/,
      /^accept all cookies$/,
      /^allow all$/,
      /^allow all cookies$/,
      /^agree$/,
      /^got it$/,
      /^consent$/,
    ];
    const REJECT_GUARD = /\b(reject|decline|refuse|deny|no thanks)\b/i;

    for (const dialog of dialogs) {
      if (!timeoutGuard()) break;
      const buttons = dialog.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]');

      for (const btn of buttons) {
        if (!timeoutGuard()) break;

        const textContent = (btn.textContent?.trim() || btn.getAttribute('aria-label') || '').toLowerCase();
        if (!textContent) continue;

        const matches = ACCEPT_PATTERNS.some(pat => pat.test(textContent));
        if (matches && !REJECT_GUARD.test(textContent) && isConsentVisible(btn)) {
          return await clickElement(btn, (btn.textContent?.trim() || btn.getAttribute('aria-label') || '').slice(0, 50), 'aria-dialog');
        }
      }
    }
  }

  // No consent overlay found
  return {
    found: false,
    clicked: false,
    buttonText: null,
    method: null,
    elapsed: Date.now() - startTime,
  };
}

/**
 * Handle messages from background script
 */
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, params } = message;

  // Ensure visuals are initialized on any Claudezilla command (lazy init)
  if (!watermarkElement && action !== 'enableClaudezillaVisuals') {
    initVisuals();
  }

  // Trigger electron animation on any command (Claude is working)
  triggerElectrons();

  // Handle async actions
  (async () => {
    try {
      let result;

      switch (action) {
        case 'enableClaudezillaVisuals':
          // This tab is now a Claudezilla-controlled tab - show visuals
          initVisuals();
          result = { enabled: true };
          break;

        case 'getContent':
          result = getContent(params);
          break;

        case 'click':
          result = await click(params);
          break;

        case 'type':
          result = await type(params);
          break;

        case 'getConsoleLogs':
          result = getConsoleLogs(params);
          break;

        case 'hideWatermark':
          if (watermarkElement) watermarkElement.style.opacity = '0';
          result = { hidden: true };
          break;

        case 'showWatermark':
          if (watermarkElement) watermarkElement.style.opacity = '';
          result = { hidden: false };
          break;

        case 'scroll':
          result = await scroll(params);
          break;

        case 'waitFor':
          result = await waitFor(params);
          break;

        case 'checkPageReadiness':
          result = await checkPageReadiness(params);
          break;

        case 'evaluate':
          result = await evaluate(params);
          break;

        case 'getElementInfo':
          result = getElementInfo(params);
          break;

        case 'awaitVisible':
          result = await awaitVisible(params);
          break;

        case 'getPageState':
          result = getPageState(params);
          break;

        case 'getAccessibilitySnapshot':
          result = getAccessibilitySnapshot(params);
          break;

        case 'annotateElements':
          result = annotateElements(params);
          break;

        case 'removeAnnotations':
          result = removeAnnotations();
          break;

        case 'handleConsent':
          result = await handleConsent(params);
          break;

        case 'resizeImage':
          result = await resizeImage(params);
          break;

        case 'find':
          result = findElements(params);
          break;

        case 'pressKey':
          result = pressKey(params);
          break;

        default:
          throw new Error(`Unknown action: ${action}`);
      }

      sendResponse({ success: true, result });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // Keep message channel open for async response
});
