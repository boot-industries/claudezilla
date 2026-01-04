#!/opt/homebrew/bin/node

/**
 * Claudezilla CLI
 *
 * Send commands to Firefox via the Claudezilla extension.
 *
 * Usage:
 *   claudezilla-cli ping
 *   claudezilla-cli navigate --url https://example.com
 *   claudezilla-cli getActiveTab
 *   claudezilla-cli getContent
 *   claudezilla-cli click --selector "button.submit"
 *   claudezilla-cli type --selector "input[name=q]" --text "hello"
 *   claudezilla-cli screenshot
 */

import { connect } from 'net';

const SOCKET_PATH = '/tmp/claudezilla.sock';

function sendCommand(command, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = connect(SOCKET_PATH);
    let buffer = '';

    socket.on('connect', () => {
      const message = JSON.stringify({ command, params }) + '\n';
      socket.write(message);
    });

    socket.on('data', (data) => {
      buffer += data.toString();

      // Check if we have a complete JSON response (newline-delimited)
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex !== -1) {
        const jsonStr = buffer.slice(0, newlineIndex);
        try {
          const response = JSON.parse(jsonStr);
          socket.end();
          resolve(response);
        } catch (e) {
          reject(new Error('Invalid response from host: ' + e.message));
        }
      }
    });

    socket.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('Claudezilla host not running. Make sure Firefox is open with the extension loaded.'));
      } else if (err.code === 'ECONNREFUSED') {
        reject(new Error('Connection refused. Make sure the extension is connected.'));
      } else {
        reject(err);
      }
    });

    socket.on('close', () => {
      // If socket closes before we got a response, try parsing buffer
      if (buffer && !buffer.includes('\n')) {
        try {
          const response = JSON.parse(buffer.trim());
          resolve(response);
        } catch (e) {
          // Only reject if we haven't already resolved
        }
      }
    });

    socket.on('timeout', () => {
      socket.end();
      reject(new Error('Connection timed out'));
    });

    socket.setTimeout(30000);
  });
}

function parseArgs(args) {
  const result = {};
  let i = 0;

  while (i < args.length) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      let value = args[i + 1];

      // Parse numeric values
      if (value && /^\d+$/.test(value)) {
        value = parseInt(value, 10);
      }
      // Parse boolean values
      if (value === 'true') value = true;
      if (value === 'false') value = false;

      result[key] = value;
      i += 2;
    } else {
      i++;
    }
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Claudezilla CLI - Control Firefox from the command line

Usage:
  claudezilla-cli <command> [options]

Window Commands:
  createWindow [--private true] [--url <url>]  Create new window (private by default)
  closeWindow --windowId <id>   Close a window
  getWindows                    List all windows

Tab Commands:
  navigate --url <url>          Navigate to URL in current tab
  getActiveTab                  Get active tab info
  getTabs                       List all tabs
  closeTab --tabId <id>         Close a tab

Page Commands:
  getContent [--selector <sel>] Get page content
  click --selector <selector>   Click an element
  type --selector <sel> --text <text>  Type into input
  screenshot                    Capture screenshot (base64)

DevTools Commands:
  getConsoleLogs [--level error] [--clear true] [--limit 100]  Get console logs
  getNetworkRequests [--type xhr] [--status error] [--limit 50]  Get network requests
  evaluate --expression <js>    Execute JavaScript in page context
  waitFor --selector <sel> [--timeout 10000]  Wait for element to appear
  scroll [--selector <sel>] [--x 0] [--y 100]  Scroll to element or position
  getElementInfo --selector <sel>  Get element attributes, styles, visibility

Utility:
  ping                          Test connection
  version                       Get version info

Examples:
  claudezilla-cli createWindow                    # Start fresh private window
  claudezilla-cli createWindow --url https://example.com
  claudezilla-cli navigate --url https://example.com
  claudezilla-cli click --selector "button[type=submit]"
  claudezilla-cli getConsoleLogs --level error    # See JS errors
  claudezilla-cli evaluate --expression "document.title"
  claudezilla-cli waitFor --selector ".loading-done"
  claudezilla-cli closeWindow --windowId 123
`);
    process.exit(0);
  }

  const command = args[0];
  const params = parseArgs(args.slice(1));

  try {
    const response = await sendCommand(command, params);

    if (response.success) {
      console.log(JSON.stringify(response.result, null, 2));
    } else {
      console.error('Error:', response.error);
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
