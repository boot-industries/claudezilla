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

    socket.on('connect', () => {
      const message = JSON.stringify({ command, params }) + '\n';
      socket.write(message);
    });

    socket.on('data', (data) => {
      try {
        const response = JSON.parse(data.toString().trim());
        socket.end();
        resolve(response);
      } catch (e) {
        reject(new Error('Invalid response from host'));
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
      const value = args[i + 1];
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

Commands:
  ping                          Test connection
  version                       Get version info
  navigate --url <url>          Navigate to URL
  getActiveTab                  Get active tab info
  getTabs                       List all tabs
  closeTab --tabId <id>         Close a tab
  getContent [--selector <sel>] Get page content
  click --selector <selector>   Click an element
  type --selector <sel> --text <text>  Type into input
  screenshot                    Capture screenshot (base64)

Examples:
  claudezilla-cli ping
  claudezilla-cli navigate --url https://example.com
  claudezilla-cli click --selector "button[type=submit]"
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
