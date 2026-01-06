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
};

// Visual elements
let watermarkElement = null;
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
 * Initialize watermark (Claude logo badge)
 */
function initWatermark() {
  if (watermarkElement) return;

  // Inject watermark glow throb animation
  if (!document.getElementById('claudezilla-watermark-styles')) {
    const style = document.createElement('style');
    style.id = 'claudezilla-watermark-styles';
    style.textContent = `
      @keyframes claudezilla-glow-throb {
        0%, 100% {
          box-shadow:
            0 0 20px 4px rgba(209, 77, 50, 0.5),
            0 0 40px 8px rgba(209, 77, 50, 0.25),
            0 0 60px 12px rgba(209, 77, 50, 0.1),
            0 4px 16px rgba(0, 0, 0, 0.5),
            inset 0 0 0 1px rgba(209, 77, 50, 0.3);
        }
        50% {
          box-shadow:
            0 0 28px 6px rgba(209, 77, 50, 0.6),
            0 0 52px 12px rgba(209, 77, 50, 0.35),
            0 0 80px 18px rgba(209, 77, 50, 0.15),
            0 4px 16px rgba(0, 0, 0, 0.5),
            inset 0 0 0 1px rgba(209, 77, 50, 0.4);
        }
      }
      /* Speech bubble - tiny, classic white comic style */
      @keyframes claudezilla-bubble-pop {
        0% { transform: scale(0); opacity: 0; }
        70% { transform: scale(1.1); }
        100% { transform: scale(1); opacity: 1; }
      }
      @keyframes claudezilla-note-bob {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-1px); }
      }
      #claudezilla-speech-bubble {
        position: absolute !important;
        top: 37px !important;
        right: 34px !important;
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
      #claudezilla-speech-bubble.singing {
        opacity: 1;
        transform: scale(1);
        animation: claudezilla-bubble-pop 0.25s ease-out forwards;
      }
      #claudezilla-speech-bubble .note {
        font-size: 7px;
        color: #1a1a1a;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        line-height: 1;
        animation: claudezilla-note-bob 0.5s ease-in-out infinite;
      }
      /* Tiny bubble tail pointing diagonally to monster's mouth */
      #claudezilla-speech-bubble::after {
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
    document.head.appendChild(style);
  }

  watermarkElement = document.createElement('div');
  watermarkElement.id = 'claudezilla-watermark';
  watermarkElement.innerHTML = CLAUDE_LOGO_SVG;
  watermarkElement.style.cssText = `
    position: fixed;
    bottom: 16px;
    left: 16px;
    width: 100px;
    height: 100px;
    background: rgba(20, 18, 18, 0.94);
    border-radius: 14px;
    padding: 12px;
    z-index: 2147483647;
    opacity: 0.95;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: visible;
    animation: claudezilla-glow-throb 4s ease-in-out infinite;
    pointer-events: auto;
    cursor: pointer;
    transition: opacity 0.3s ease, transform 0.15s ease;
  `;

  // Click to open extension popup
  watermarkElement.addEventListener('click', () => {
    browser.runtime.sendMessage({ action: 'openPopup' });
  });

  // Hover effect
  watermarkElement.addEventListener('mouseenter', () => {
    watermarkElement.style.transform = 'scale(1.05)';
  });
  watermarkElement.addEventListener('mouseleave', () => {
    watermarkElement.style.transform = 'scale(1)';
  });

  document.body.appendChild(watermarkElement);

  // Create speech bubble (singing note - appears when working)
  // Append inside watermark for relative positioning
  speechBubbleElement = document.createElement('div');
  speechBubbleElement.id = 'claudezilla-speech-bubble';
  speechBubbleElement.innerHTML = '<span class="note">♪</span>';
  watermarkElement.appendChild(speechBubbleElement);
}

/**
 * Initialize focusglow element
 */
function initFocusglow() {
  if (focusglowElement) return;

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
 * @param {string} selector - CSS selector of target element
 */
function moveFocusTo(selector) {
  if (!settings.showFocusglow || !focusglowElement) {
    return;
  }

  // Safe selector query - don't throw on invalid, just skip
  let el;
  try {
    el = document.querySelector(selector);
  } catch (e) {
    return; // Invalid selector, skip focus glow
  }
  if (!el) {
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

  const electrons = watermarkElement.querySelector('#claudezilla-electrons');
  const arms = watermarkElement.querySelector('#claudezilla-arms');
  if (!electrons) return;

  // Show electrons, arms, and speech bubble (Claudezilla sings while working!)
  electrons.style.opacity = '1';
  if (arms) arms.style.opacity = '1';
  if (speechBubbleElement) speechBubbleElement.classList.add('singing');

  // Hide after 5s idle (with gradual 1.5s fade)
  clearTimeout(electronTimeout);
  electronTimeout = setTimeout(() => {
    electrons.style.opacity = '0';
    if (arms) arms.style.opacity = '0';
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
 * Initialize visual effects
 */
function initVisuals() {
  // Only initialize in top frame
  if (window !== window.top) return;

  loadSettings();
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
let consoleCapureEnabled = false;

const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
};

function captureLog(level, args) {
  // Only capture if enabled
  if (!consoleCapureEnabled) return;

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
  if (consoleCapureEnabled) return;
  consoleCapureEnabled = true;

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
  if (!consoleCapureEnabled) {
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
    captureEnabled: consoleCapureEnabled,
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

/**
 * Scroll to element or position
 * @param {object} params - Parameters
 * @param {string} params.selector - CSS selector to scroll to
 * @param {number} params.x - X position to scroll to
 * @param {number} params.y - Y position to scroll to
 * @param {string} params.behavior - 'smooth' or 'instant' (default: smooth)
 * @returns {object} Result
 */
function scroll(params = {}) {
  const { selector, x, y, behavior = 'smooth' } = params;

  if (selector) {
    // SECURITY: Validate selector before use
    const element = safeQuerySelector(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }
    // Show focusglow on scroll target
    moveFocusTo(selector);
    element.scrollIntoView({ behavior, block: 'center' });
    const rect = element.getBoundingClientRect();
    return {
      selector,
      scrolledTo: true,
      elementPosition: { x: rect.x, y: rect.y },
    };
  }

  if (x !== undefined || y !== undefined) {
    window.scrollTo({
      left: x ?? window.scrollX,
      top: y ?? window.scrollY,
      behavior,
    });
    return {
      scrolledTo: true,
      position: { x: window.scrollX, y: window.scrollY },
    };
  }

  // Return current scroll position
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
  const { selector, timeout = 10000, interval = 100 } = params;

  // SECURITY: Validate selector before use
  validateSelector(selector);

  const startTime = Date.now();

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
 * Evaluate JavaScript in page context
 * @param {object} params - Parameters
 * @param {string} params.expression - JavaScript expression to evaluate
 * @returns {object} Result
 */
function evaluate(params) {
  const { expression } = params;

  if (!expression) {
    throw new Error('expression is required');
  }

  try {
    // Use Function constructor for safer eval
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
  const { selector } = params;

  // SECURITY: Validate selector before use
  const element = safeQuerySelector(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  // Show focusglow on inspected element
  moveFocusTo(selector);

  const rect = element.getBoundingClientRect();
  const styles = window.getComputedStyle(element);

  // Get all attributes
  const attributes = {};
  for (const attr of element.attributes) {
    attributes[attr.name] = attr.value;
  }

  return {
    selector,
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
 * Get page content
 * @param {object} params - Parameters
 * @param {string} params.selector - Optional CSS selector to get specific element
 * @param {boolean} params.includeHtml - Include HTML in response (default: false)
 * @param {number} params.maxLength - Max text length before truncation (default: 50000)
 * @returns {object} Page content
 */
function getContent(params = {}) {
  const { selector, includeHtml = false, maxLength = 50000 } = params;

  // Helper to truncate text
  function truncateText(text, limit) {
    if (!text || text.length <= limit) return { text, truncated: false };
    return {
      text: text.slice(0, limit) + '\n\n[... truncated, use selector for specific content]',
      truncated: true
    };
  }

  if (selector) {
    // SECURITY: Validate selector before use
    const element = safeQuerySelector(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }
    // Show focusglow on read element
    moveFocusTo(selector);

    const rawText = element.textContent?.trim() || '';
    const { text, truncated } = truncateText(rawText, maxLength);

    const result = {
      selector,
      text,
      tagName: element.tagName.toLowerCase(),
      textLength: rawText.length,
      truncated,
    };
    if (includeHtml) {
      result.html = element.innerHTML;
    }
    return result;
  }

  const rawText = document.body?.textContent?.trim() || '';
  const { text, truncated } = truncateText(rawText, maxLength);

  const result = {
    url: window.location.href,
    title: document.title,
    text,
    textLength: rawText.length,
    truncated,
  };
  if (includeHtml) {
    result.html = document.documentElement.outerHTML;
  }
  return result;
}

/**
 * Click an element
 * @param {object} params - Parameters
 * @param {string} params.selector - CSS selector for element to click
 * @returns {object} Result
 */
function click(params) {
  const { selector } = params;

  // SECURITY: Validate selector before use
  const element = safeQuerySelector(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  // Show focusglow on clicked element
  moveFocusTo(selector);

  // Scroll element into view
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Simulate click
  element.click();

  return {
    selector,
    clicked: true,
    tagName: element.tagName.toLowerCase(),
    text: element.textContent?.trim().slice(0, 100) || '',
    id: element.id || null,
    className: element.className || null,
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

  if (text === undefined) {
    throw new Error('text is required');
  }

  // SECURITY: Validate selector before use
  const element = safeQuerySelector(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  // Check if element is an input or textarea
  const isInput = element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';
  const isContentEditable = element.isContentEditable;

  if (!isInput && !isContentEditable) {
    throw new Error(`Element is not editable: ${selector}`);
  }

  // Show focusglow on input element
  moveFocusTo(selector);

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
    selector,
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

  // Headings
  document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(el => {
    const text = el.textContent?.trim();
    if (text) {
      allHeadings.push({ level: el.tagName.toLowerCase(), text: text.slice(0, 100) });
    }
  });

  // Links (visible, with text)
  document.querySelectorAll('a[href]').forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const text = el.textContent?.trim() || el.getAttribute('aria-label') || '';
      if (text) {
        allLinks.push({
          text: text.slice(0, 50),
          href: el.getAttribute('href')?.slice(0, 100),
        });
      }
    }
  });

  // Buttons
  document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      allButtons.push({
        text: (el.textContent?.trim() || el.value || el.getAttribute('aria-label') || '').slice(0, 50),
        disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
        type: el.type || 'button',
      });
    }
  });

  // Form inputs
  document.querySelectorAll('input, textarea, select').forEach(el => {
    if (el.type === 'hidden') return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      allInputs.push({
        type: el.type || el.tagName.toLowerCase(),
        name: el.name || el.id || '',
        label: el.getAttribute('aria-label') || el.placeholder || document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() || '',
        value: el.type === 'password' ? '***' : (el.value?.slice(0, 50) || ''),
        required: el.required,
        disabled: el.disabled,
      });
    }
  });

  // Images with alt text
  document.querySelectorAll('img[alt]').forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width > 20 && rect.height > 20) {
      allImages.push({
        alt: el.alt.slice(0, 100),
        src: el.src?.slice(0, 100),
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

/**
 * Get accessibility tree snapshot
 * @param {object} params - Parameters
 * @param {number} params.maxDepth - Max tree depth (default: 5)
 * @param {number} params.maxNodes - Max nodes to include (default: 200)
 * @param {string} params.selector - Root element selector (default: body)
 * @returns {object} Accessibility tree
 */
function getAccessibilitySnapshot(params = {}) {
  const { maxDepth = 5, maxNodes = 200, selector = 'body' } = params;
  // SECURITY: Validate selector before use (default 'body' is always valid)
  const root = selector === 'body' ? document.body : safeQuerySelector(selector);
  if (!root) throw new Error(`Element not found: ${selector}`);

  let nodeCount = 0;
  let truncated = false;

  function getAccessibleName(el) {
    return el.getAttribute('aria-label') ||
           el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent?.trim() ||
           el.getAttribute('title') ||
           el.getAttribute('alt') ||
           (el.tagName === 'INPUT' && el.placeholder) ||
           (el.tagName === 'IMG' && el.alt) ||
           (el.labels?.[0]?.textContent?.trim()) ||
           '';
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

  function walkTree(el, depth = 0) {
    if (depth > maxDepth) return null;
    if (nodeCount >= maxNodes) {
      truncated = true;
      return null;
    }

    const rect = el.getBoundingClientRect();
    const isVisible = rect.width > 0 && rect.height > 0 &&
                      window.getComputedStyle(el).display !== 'none' &&
                      window.getComputedStyle(el).visibility !== 'hidden';

    if (!isVisible && el !== root) return null;

    const role = getRole(el);
    const name = getAccessibleName(el);
    const text = el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
                 ? el.textContent?.trim().slice(0, 100)
                 : '';

    // Skip non-semantic elements without accessible info
    if (!role && !name && !text && el.tagName.match(/^(DIV|SPAN|P)$/i)) {
      // But still process children
      const children = [];
      for (const child of el.children) {
        const childNode = walkTree(child, depth);
        if (childNode) children.push(childNode);
      }
      return children.length === 1 ? children[0] : (children.length > 1 ? { children } : null);
    }

    // Count this as a meaningful node
    nodeCount++;

    const node = {};
    if (role) node.role = role;
    if (name) node.name = name;
    if (text) node.text = text;

    // State
    if (el.disabled) node.disabled = true;
    if (el.checked) node.checked = true;
    if (el.getAttribute('aria-expanded')) node.expanded = el.getAttribute('aria-expanded') === 'true';
    if (el.getAttribute('aria-selected')) node.selected = el.getAttribute('aria-selected') === 'true';
    if (el.value && el.tagName.match(/^(INPUT|TEXTAREA|SELECT)$/i) && el.type !== 'password') {
      node.value = el.value.slice(0, 50);
    }

    // Children
    const children = [];
    for (const child of el.children) {
      const childNode = walkTree(child, depth + 1);
      if (childNode) {
        if (Array.isArray(childNode)) {
          children.push(...childNode);
        } else {
          children.push(childNode);
        }
      }
    }
    if (children.length > 0) node.children = children.slice(0, 50);

    return Object.keys(node).length > 0 ? node : null;
  }

  const tree = walkTree(root);

  return {
    url: window.location.href,
    title: document.title,
    tree,
    nodeCount,
    maxNodes,
    truncated,
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
  if (selector) {
    // SECURITY: Validate selector before use
    target = safeQuerySelector(selector);
    if (!target) {
      throw new Error(`Element not found: ${selector}`);
    }
    target.focus();
    moveFocusTo(selector);
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
    selector: selector || '(active element)',
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
          result = click(params);
          break;

        case 'type':
          result = type(params);
          break;

        case 'getConsoleLogs':
          result = getConsoleLogs(params);
          break;

        case 'scroll':
          result = scroll(params);
          break;

        case 'waitFor':
          result = await waitFor(params);
          break;

        case 'evaluate':
          result = evaluate(params);
          break;

        case 'getElementInfo':
          result = getElementInfo(params);
          break;

        case 'getPageState':
          result = getPageState(params);
          break;

        case 'getAccessibilitySnapshot':
          result = getAccessibilitySnapshot(params);
          break;

        case 'resizeImage':
          result = await resizeImage(params);
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
