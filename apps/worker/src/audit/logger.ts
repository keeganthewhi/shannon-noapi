// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * Append-Only Agent Logger
 *
 * Provides crash-safe, append-only logging for agent execution.
 * Uses LogStream for stream management with backpressure handling.
 */

import { atomicWrite } from '../utils/file-io.js';
import { formatTimestamp } from '../utils/formatting.js';
import { LogStream } from './log-stream.js';
import { generateLogPath, generatePromptPath, type SessionMetadata } from './utils.js';

interface LogEvent {
  type: string;
  timestamp: string;
  data: unknown;
}

const SENSITIVE_PATTERNS = [
  /(?:password|passwd|secret|token|api[_-]?key|auth|bearer|credential|private[_-]?key)\s*[:=]\s*\S+/gi,
  /(?:sk-|pk-|ghp_|gho_|ghs_|ghr_|glpat-|xox[bpsar]-)[A-Za-z0-9_-]+/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

function redactSensitive(input: string): string {
  let result = input;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

/**
 * AgentLogger - Manages append-only logging for a single agent execution
 */
export class AgentLogger {
  private readonly sessionMetadata: SessionMetadata;
  private readonly agentName: string;
  private readonly attemptNumber: number;
  private readonly timestamp: number;
  private readonly logStream: LogStream;

  constructor(sessionMetadata: SessionMetadata, agentName: string, attemptNumber: number) {
    this.sessionMetadata = sessionMetadata;
    this.agentName = agentName;
    this.attemptNumber = attemptNumber;
    this.timestamp = Date.now();

    const logPath = generateLogPath(sessionMetadata, agentName, this.timestamp, attemptNumber);
    this.logStream = new LogStream(logPath);
  }

  /**
   * Initialize the log stream (creates file and opens stream)
   */
  async initialize(): Promise<void> {
    if (this.logStream.isOpen) {
      return; // Already initialized
    }

    await this.logStream.open();

    // Write header
    await this.writeHeader();
  }

  /**
   * Write header to log file
   */
  private async writeHeader(): Promise<void> {
    const header = [
      `========================================`,
      `Agent: ${this.agentName}`,
      `Attempt: ${this.attemptNumber}`,
      `Started: ${formatTimestamp(this.timestamp)}`,
      `Session: ${this.sessionMetadata.id}`,
      `Web URL: ${this.sessionMetadata.webUrl}`,
      `========================================\n`,
    ].join('\n');

    return this.logStream.write(header);
  }

  /**
   * Log an event (tool_start, tool_end, llm_response, etc.)
   * Events are logged as JSON for parseability
   */
  async logEvent(eventType: string, eventData: unknown): Promise<void> {
    const event: LogEvent = {
      type: eventType,
      timestamp: formatTimestamp(),
      data: eventData,
    };

    const eventLine = redactSensitive(`${JSON.stringify(event)}\n`);
    return this.logStream.write(eventLine);
  }

  /**
   * Close the log stream
   */
  async close(): Promise<void> {
    return this.logStream.close();
  }

  /**
   * Save prompt snapshot to prompts directory
   * Static method - doesn't require logger instance
   */
  static async savePrompt(sessionMetadata: SessionMetadata, agentName: string, promptContent: string): Promise<void> {
    const promptPath = generatePromptPath(sessionMetadata, agentName);

    // Create header with metadata
    const header = [
      `# Prompt Snapshot: ${agentName}`,
      ``,
      `**Session:** ${sessionMetadata.id}`,
      `**Web URL:** ${sessionMetadata.webUrl}`,
      `**Saved:** ${formatTimestamp()}`,
      ``,
      `---`,
      ``,
    ].join('\n');

    const fullContent = header + promptContent;

    // Use atomic write for safety
    await atomicWrite(promptPath, fullContent);
  }
}
