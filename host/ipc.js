/**
 * Claudezilla IPC Abstraction Layer
 *
 * Provides platform-independent IPC paths and utilities.
 * Supports:
 *   - macOS/Linux: Unix sockets (e.g., /tmp/claudezilla.sock)
 *   - Windows: Named pipes (e.g., \\.\pipe\claudezilla)
 */

import { platform, tmpdir } from 'os';
import { join, dirname } from 'path';
import { existsSync, unlinkSync, chmodSync, mkdirSync } from 'fs';

const IS_WINDOWS = platform() === 'win32';

/**
 * Get a validated temp directory for IPC files
 * - Windows: Uses LOCALAPPDATA or TEMP
 * - Unix: Prefers XDG_RUNTIME_DIR (secure, per-user) then falls back to tmpdir()
 *
 * @returns {string} Safe temporary directory path
 */
export function getSafeTempDir() {
  if (IS_WINDOWS) {
    // On Windows, prefer LOCALAPPDATA for user-specific data
    // Falls back to TEMP if not available
    return process.env.LOCALAPPDATA || process.env.TEMP || tmpdir();
  }

  // On macOS/Linux, prefer XDG_RUNTIME_DIR if available (per-user, secure)
  const xdgRuntime = process.env.XDG_RUNTIME_DIR;
  if (xdgRuntime && existsSync(xdgRuntime)) {
    return xdgRuntime;
  }
  return tmpdir();
}

/**
 * Get the IPC socket/pipe path for host↔MCP communication
 *
 * @returns {string} Platform-appropriate IPC path
 */
export function getSocketPath() {
  if (IS_WINDOWS) {
    // Named pipe path on Windows
    // Named pipes auto-cleanup when server closes, no file management needed
    return '\\\\.\\pipe\\claudezilla';
  }

  // Unix socket path
  return join(getSafeTempDir(), 'claudezilla.sock');
}

/**
 * Get the auth token file path
 * Host writes this file on startup, MCP server reads it for authentication
 *
 * @returns {string} Path to auth token file
 */
export function getAuthTokenPath() {
  if (IS_WINDOWS) {
    // Store in LOCALAPPDATA on Windows (per-user, not temp)
    const localAppData = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Local');
    return join(localAppData, 'claudezilla', 'auth.token');
  }

  // Unix: Store alongside socket in secure temp dir
  return join(getSafeTempDir(), 'claudezilla-auth.token');
}

/**
 * Get the debug log file path
 *
 * @returns {string} Path to debug log file
 */
export function getDebugLogPath() {
  if (IS_WINDOWS) {
    const localAppData = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Local');
    return join(localAppData, 'claudezilla', 'debug.log');
  }

  return join(getSafeTempDir(), 'claudezilla-debug.log');
}

/**
 * Clean up the socket file (Unix only)
 * Named pipes on Windows auto-cleanup when server closes
 *
 * @param {string} socketPath - Path to the socket file
 */
export function cleanupSocket(socketPath) {
  // Named pipes auto-cleanup on Windows, no action needed
  if (IS_WINDOWS) {
    return;
  }

  // On Unix, remove stale socket file if it exists
  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath);
    } catch (e) {
      // Ignore errors - file may already be gone
    }
  }
}

/**
 * Set secure permissions on a file (Unix only)
 * On Windows, rely on user profile folder permissions (ACLs)
 *
 * @param {string} filePath - Path to the file
 * @param {number} mode - Unix permissions mode (default: 0o600)
 */
export function setSecurePermissions(filePath, mode = 0o600) {
  // Windows doesn't support Unix-style chmod
  // Files in LOCALAPPDATA are already user-only by default
  if (IS_WINDOWS) {
    return;
  }

  try {
    chmodSync(filePath, mode);
  } catch (e) {
    // Log warning but don't fail - permissions are a defense-in-depth measure
    console.error(`[claudezilla] Warning: Could not set permissions on ${filePath}:`, e.message);
  }
}

/**
 * Ensure parent directory exists for file creation
 * Required on Windows for auth token directory creation
 *
 * @param {string} filePath - Path to file that will be created
 */
export function ensureParentDir(filePath) {
  const dir = dirname(filePath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Check if running on Windows
 *
 * @returns {boolean} True if running on Windows
 */
export function isWindows() {
  return IS_WINDOWS;
}

/**
 * Get platform-specific paths object (for logging/diagnostics)
 *
 * @returns {Object} Object with all relevant paths
 */
export function getPaths() {
  return {
    platform: platform(),
    isWindows: IS_WINDOWS,
    tempDir: getSafeTempDir(),
    socketPath: getSocketPath(),
    authTokenPath: getAuthTokenPath(),
    debugLogPath: getDebugLogPath(),
  };
}
