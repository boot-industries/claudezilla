/**
 * Native Messaging Protocol Handler
 *
 * Firefox native messaging uses:
 * - 4-byte unsigned integer (native byte order) for message length
 * - UTF-8 encoded JSON payload
 *
 * Max message sizes:
 * - Host → Extension: 1 MB
 * - Extension → Host: 4 GB
 */

/**
 * Read a message from stdin
 * @returns {Promise<object|null>} Parsed JSON message, or null on EOF
 */
export async function readMessage() {
  // Read 4-byte length header
  const headerBuffer = await readBytes(4);
  if (!headerBuffer) {
    return null; // EOF
  }

  // Parse length (native byte order = little-endian on most systems)
  const messageLength = headerBuffer.readUInt32LE(0);

  if (messageLength === 0) {
    return {};
  }

  if (messageLength > 4 * 1024 * 1024 * 1024) {
    throw new Error(`Message too large: ${messageLength} bytes`);
  }

  // Read message payload
  const messageBuffer = await readBytes(messageLength);
  if (!messageBuffer) {
    throw new Error('Unexpected EOF while reading message');
  }

  // Parse JSON
  const messageText = messageBuffer.toString('utf-8');
  return JSON.parse(messageText);
}

/**
 * Send a message to stdout
 * @param {object} message - Object to send as JSON
 */
export function sendMessage(message) {
  const messageText = JSON.stringify(message);
  const messageBuffer = Buffer.from(messageText, 'utf-8');

  // Check size limit (1 MB for host → extension)
  if (messageBuffer.length > 1024 * 1024) {
    throw new Error(`Message too large: ${messageBuffer.length} bytes (max 1 MB)`);
  }

  // Write 4-byte length header
  const headerBuffer = Buffer.alloc(4);
  headerBuffer.writeUInt32LE(messageBuffer.length, 0);

  process.stdout.write(headerBuffer);
  process.stdout.write(messageBuffer);
}

/**
 * Read exact number of bytes from stdin
 * @param {number} count - Number of bytes to read
 * @returns {Promise<Buffer|null>} Buffer with bytes, or null on EOF
 */
function readBytes(count) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytesRead = 0;

    const onReadable = () => {
      while (bytesRead < count) {
        const chunk = process.stdin.read(count - bytesRead);
        if (chunk === null) {
          // Not enough data yet, wait for more
          return;
        }
        chunks.push(chunk);
        bytesRead += chunk.length;
      }

      cleanup();
      resolve(Buffer.concat(chunks));
    };

    const onEnd = () => {
      cleanup();
      if (bytesRead === 0) {
        resolve(null); // Clean EOF
      } else {
        reject(new Error(`Unexpected EOF: expected ${count} bytes, got ${bytesRead}`));
      }
    };

    const onError = (err) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      process.stdin.removeListener('readable', onReadable);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onError);
    };

    process.stdin.on('readable', onReadable);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);

    // Try reading immediately in case data is already available
    onReadable();
  });
}
