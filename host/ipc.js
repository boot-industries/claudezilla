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
 * SECURITY: Validate a path for safety
 * Prevents null bytes, path traversal, and UNC network paths
 *
 * @param {string} path - Path to validate
 * @param {string} context - Description for error messages
 * @returns {boolean} True if valid
 * @throws {Error} If path is invalid
 */
export function validatePath(path, context = 'path') {
  if (!path || typeof path !== 'string') {
    throw new Error(`${context} is empty or invalid`);
  }
  if (path.includes('\0')) {
    throw new Error(`${context} contains null byte`);
  }
  if (path.includes('..')) {
    throw new Error(`${context} contains path traversal`);
  }
  // Block UNC network paths on Windows (except named pipes which start with \\.\pipe\)
  if (IS_WINDOWS && path.startsWith('\\\\') && !path.startsWith('\\\\.\\pipe\\')) {
    throw new Error(`${context} is a UNC network path`);
  }
  return true;
}

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
    const candidates = [
      process.env.LOCALAPPDATA,
      process.env.TEMP,
      tmpdir()
    ].filter(Boolean);

    // SECURITY: Validate paths from environment variables
    for (const candidate of candidates) {
      try {
        validatePath(candidate, 'temp directory');
        return candidate;
      } catch (e) {
        console.error(`[claudezilla] Skipping invalid temp path: ${e.message}`);
      }
    }
    throw new Error('No valid temp directory found');
  }

  // On macOS/Linux, prefer XDG_RUNTIME_DIR if available (per-user, secure)
  const xdgRuntime = process.env.XDG_RUNTIME_DIR;
  if (xdgRuntime) {
    try {
      validatePath(xdgRuntime, 'XDG_RUNTIME_DIR');
      if (existsSync(xdgRuntime)) {
        return xdgRuntime;
      }
    } catch (e) {
      console.error(`[claudezilla] Skipping invalid XDG_RUNTIME_DIR: ${e.message}`);
    }
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
 * SECURITY: Set Windows ACL on a file to restrict access to current user only
 * Uses icacls to remove inheritance and grant full control only to the current user
 *
 * @param {string} filePath - Path to the file
 */
export async function setWindowsFileACL(filePath) {
  if (!IS_WINDOWS) return;

  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    // Remove inherited permissions and grant only current user full control
    // /inheritance:r - Remove all inherited ACEs
    // /grant:r - Replace (not add) permissions for specified user
    // %USERNAME%:(F) - Full control for current user
    await execAsync(`icacls "${filePath}" /inheritance:r /grant:r "%USERNAME%:(F)"`, {
      shell: 'cmd.exe'
    });
    console.error(`[claudezilla] Set ACL on ${filePath}`);
  } catch (e) {
    // Log warning but don't fail - ACL is a defense-in-depth measure
    console.error(`[claudezilla] Warning: Could not set ACL on ${filePath}: ${e.message}`);
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
