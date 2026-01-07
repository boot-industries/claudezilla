/**
 * Task Detector for Claudezilla Focus Loops (v0.5.1)
 *
 * Detects iterative tasks that would benefit from focus loops.
 * Uses keyword matching and behavioral pattern analysis.
 */

// Iterative task keywords (score contribution: 5)
const ITERATIVE_KEYWORDS = [
  'tdd',
  'test-driven',
  'test driven',
  'iterate',
  'iterative',
  'refactor',
  'keep trying',
  'keep fixing',
  'fix until',
  'repeat until',
  'until it passes',
  'until it works',
  'until all tests pass',
  'until the build succeeds',
  'try again',
  'retry',
  'debug until',
  'fix errors',
  'resolve issues',
  'improvement loop',
];

// High-confidence keywords (score contribution: 4)
const HIGH_CONFIDENCE_KEYWORDS = [
  'focus loop',
  'ralph loop',
  'persistent iteration',
  'iterative development',
  'continuous improvement',
];

/**
 * TaskDetector class for detecting iterative tasks
 */
export class TaskDetector {
  constructor() {
    this.commandHistory = [];         // Last 50 commands
    this.fileEditHistory = new Map(); // file -> [timestamps]
    this.errorPatterns = [];          // Recurring error messages
    this.enabled = true;              // Detection enabled flag
    this.settings = {
      autoDetect: true,
      autoStart: false,
      defaultMaxIterations: 15,
    };
  }

  /**
   * Update settings from storage
   * @param {object} settings - Settings object
   */
  updateSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    this.enabled = settings.autoDetect !== false;
  }

  /**
   * Detect if a task/prompt is iterative
   * @param {string} prompt - User prompt or task description
   * @returns {object} Detection result
   */
  detectIterativeTask(prompt) {
    if (!this.enabled || !prompt) {
      return { detected: false, confidence: 'low', score: 0 };
    }

    let score = 0;
    const reasons = [];
    const promptLower = prompt.toLowerCase();

    // Keyword detection
    for (const keyword of ITERATIVE_KEYWORDS) {
      if (promptLower.includes(keyword)) {
        score += 5;
        reasons.push(`Keyword: "${keyword}"`);
        break; // Only count first match
      }
    }

    for (const keyword of HIGH_CONFIDENCE_KEYWORDS) {
      if (promptLower.includes(keyword)) {
        score += 4;
        reasons.push(`High-confidence keyword: "${keyword}"`);
        break;
      }
    }

    // Behavioral patterns
    const recentCommands = this.commandHistory.slice(-20);

    // Check for repeated test runs
    const testCommands = recentCommands.filter(c =>
      c.params?.command?.includes('test') ||
      c.params?.command?.includes('pytest') ||
      c.params?.command?.includes('jest') ||
      c.params?.command?.includes('npm test')
    );
    if (testCommands.length >= 3) {
      score += 3;
      reasons.push(`Repeated test runs: ${testCommands.length}`);
    }

    // Check for repeated file edits
    const recentEdits = Array.from(this.fileEditHistory.entries())
      .filter(([file, timestamps]) => {
        const recent = timestamps.filter(t => Date.now() - t < 10 * 60 * 1000); // Last 10 minutes
        return recent.length >= 3;
      });
    if (recentEdits.length > 0) {
      score += 2;
      reasons.push(`Repeated file edits: ${recentEdits.length} files`);
    }

    // Determine confidence level
    let confidence;
    if (score >= 8) {
      confidence = 'high';
    } else if (score >= 5) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    return {
      detected: score >= 5,
      confidence,
      score,
      reasons,
      suggestedMaxIterations: this.settings.defaultMaxIterations,
      shouldAutoStart: this.settings.autoStart && confidence === 'high',
    };
  }

  /**
   * Record a command for behavioral pattern analysis
   * @param {string} command - Command name
   * @param {object} params - Command parameters
   * @param {object} result - Command result
   */
  recordCommand(command, params, result) {
    this.commandHistory.push({
      command,
      params,
      result,
      timestamp: Date.now(),
      success: !result?.isError,
    });

    // Keep only last 50 commands
    if (this.commandHistory.length > 50) {
      this.commandHistory.shift();
    }

    // Track file edits (if this looks like an edit command)
    if (command === 'Edit' || command === 'Write') {
      const file = params?.file_path;
      if (file) {
        if (!this.fileEditHistory.has(file)) {
          this.fileEditHistory.set(file, []);
        }
        this.fileEditHistory.get(file).push(Date.now());

        // Keep only last 10 timestamps per file
        if (this.fileEditHistory.get(file).length > 10) {
          this.fileEditHistory.get(file).shift();
        }
      }
    }

    // Track errors
    if (result?.isError && result?.text) {
      this.errorPatterns.push({
        error: result.text,
        timestamp: Date.now(),
      });

      // Keep only last 20 errors
      if (this.errorPatterns.length > 20) {
        this.errorPatterns.shift();
      }
    }
  }

  /**
   * Get iterative patterns from history
   * @returns {object} Pattern analysis
   */
  getIterativePatterns() {
    const recentCommands = this.commandHistory.slice(-20);

    // Count command types
    const commandCounts = {};
    recentCommands.forEach(c => {
      commandCounts[c.command] = (commandCounts[c.command] || 0) + 1;
    });

    // Check for repeated failures
    const failures = recentCommands.filter(c => !c.success);

    // Find repeated file edits
    const editedFiles = Array.from(this.fileEditHistory.entries())
      .map(([file, timestamps]) => ({
        file,
        editCount: timestamps.filter(t => Date.now() - t < 10 * 60 * 1000).length,
      }))
      .filter(f => f.editCount >= 2);

    return {
      totalCommands: recentCommands.length,
      commandCounts,
      failureCount: failures.length,
      editedFiles,
      errorCount: this.errorPatterns.length,
    };
  }

  /**
   * Reset detector state
   */
  reset() {
    this.commandHistory = [];
    this.fileEditHistory.clear();
    this.errorPatterns = [];
  }

  /**
   * Enable or disable detection
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }
}

// Export singleton instance
export const taskDetector = new TaskDetector();

// Export default for CommonJS compatibility
export default TaskDetector;
