/**
 * Size-capped debug log for the native messaging host.
 *
 * The host appends every line to the debug log. Without a cap a busy or
 * misbehaving client grows it without bound, and the default location in
 * XDG_RUNTIME_DIR is a small tmpfs shared with the rest of the user session.
 * Once the file would exceed maxBytes it is renamed to `<path>.1` (replacing
 * the previous one) and a fresh file is started, so at most about twice
 * maxBytes stay on disk.
 */

import { appendFileSync, renameSync, statSync, writeFileSync } from 'fs';

export const DEFAULT_DEBUG_LOG_MAX_BYTES = 10 * 1024 * 1024; // 10MB

export function appendDebugLog(path, msg, maxBytes = DEFAULT_DEBUG_LOG_MAX_BYTES) {
  let size = -1;
  try {
    size = statSync(path).size;
  } catch {
    // Missing file: created below
  }

  if (size >= 0 && size + Buffer.byteLength(msg) > maxBytes) {
    renameSync(path, `${path}.1`);
    size = -1;
  }

  // Create log file with restricted permissions if it doesn't exist
  if (size < 0) {
    writeFileSync(path, '', { mode: 0o600 });
  }
  appendFileSync(path, msg);
}
