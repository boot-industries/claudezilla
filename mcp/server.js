#!/usr/bin/env node

/**
 * Claudezilla MCP Server
 *
 * Exposes Firefox browser automation as MCP tools for Claude.
 * Connects to the Claudezilla native host via Unix socket.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { connect } from 'net';

const SOCKET_PATH = '/tmp/claudezilla.sock';

/**
 * Send command to Claudezilla via Unix socket
 */
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
        reject(new Error('Invalid response from Claudezilla host'));
      }
    });

    socket.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('Claudezilla not running. Open Firefox with the Claudezilla extension loaded.'));
      } else if (err.code === 'ECONNREFUSED') {
        reject(new Error('Connection refused. Reload the Claudezilla extension in Firefox.'));
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

// Tool definitions
const TOOLS = [
  {
    name: 'firefox_create_window',
    description: 'Create a new private Firefox browser window. Always call this first before other browser commands. Returns windowId for reference.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Optional URL to open in the new window',
        },
      },
    },
  },
  {
    name: 'firefox_navigate',
    description: 'Navigate to a URL in the current Firefox tab. Requires a private window (use firefox_create_window first).',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'firefox_get_content',
    description: 'Get the text content of the current page or a specific element. Returns structured data with url, title, and text content.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'Optional CSS selector to get content from a specific element',
        },
      },
    },
  },
  {
    name: 'firefox_click',
    description: 'Click an element on the page by CSS selector.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the element to click (e.g., "button.submit", "#login-btn", "a[href*=login]")',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'firefox_type',
    description: 'Type text into an input field.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the input element',
        },
        text: {
          type: 'string',
          description: 'Text to type into the input',
        },
        clear: {
          type: 'boolean',
          description: 'Whether to clear existing text first (default: true)',
        },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'firefox_screenshot',
    description: 'Capture a screenshot of the visible browser viewport. Returns base64-encoded PNG.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'firefox_get_tabs',
    description: 'List all open browser tabs with their URLs and titles.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'firefox_close_window',
    description: 'Close a browser window by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        windowId: {
          type: 'number',
          description: 'The window ID to close',
        },
      },
      required: ['windowId'],
    },
  },
];

// Map MCP tool names to Claudezilla commands
const TOOL_TO_COMMAND = {
  firefox_create_window: 'createWindow',
  firefox_navigate: 'navigate',
  firefox_get_content: 'getContent',
  firefox_click: 'click',
  firefox_type: 'type',
  firefox_screenshot: 'screenshot',
  firefox_get_tabs: 'getTabs',
  firefox_close_window: 'closeWindow',
};

// Create MCP server
const server = new Server(
  {
    name: 'claudezilla',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const command = TOOL_TO_COMMAND[name];
  if (!command) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const response = await sendCommand(command, args || {});

    if (response.success) {
      // Special handling for screenshots - return as image
      if (name === 'firefox_screenshot' && response.result?.dataUrl) {
        const base64Data = response.result.dataUrl.replace(/^data:image\/png;base64,/, '');
        return {
          content: [
            {
              type: 'image',
              data: base64Data,
              mimeType: 'image/png',
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.result, null, 2),
          },
        ],
      };
    } else {
      return {
        content: [{ type: 'text', text: `Error: ${response.error}` }],
        isError: true,
      };
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Claudezilla MCP server running');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
