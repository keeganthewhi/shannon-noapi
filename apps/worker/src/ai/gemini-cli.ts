/**
 * Google Gemini CLI adapter for Shannon.
 *
 * Spawns `gemini -p <prompt> --output-format stream-json --yolo` and
 * normalizes Gemini JSONL events into Shannon's CLIMessage format.
 *
 * Gemini CLI uses a stream-json format similar to Claude Code:
 *   system     → system init
 *   assistant  → assistant message
 *   tool_use   → tool call
 *   tool_result → tool output
 *   result     → final result
 *
 * Set GEMINI_BINARY env var to override the `gemini` binary path.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CLIMessage, ClaudeCodeOptions, SDKAssistantMessageError } from './claude-code-cli.js';

function resolveGeminiBinary(): string {
  return process.env.GEMINI_BINARY || 'gemini';
}

function buildArgs(prompt: string, options: ClaudeCodeOptions): string[] {
  const args: string[] = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--yolo',
  ];

  // Only pass -m if it's a Gemini model (not Anthropic defaults)
  if (options.model && !options.model.startsWith('claude-')) {
    args.push('-m', options.model);
  }

  // Gemini uses --include-directories instead of --cwd
  if (options.cwd) {
    args.push('--include-directories', options.cwd);
  }

  return args;
}

function buildEnv(options: ClaudeCodeOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      env[key] = value;
    }
  }
  return env;
}

/**
 * Parse a Gemini JSONL line into a Shannon CLIMessage.
 *
 * Gemini's stream-json format is close to Claude Code's but may have
 * slightly different field names. This normalizer handles both formats.
 */
function parseGeminiEvent(line: string): CLIMessage | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) return null;

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }

  const eventType = event.type as string | undefined;
  if (!eventType) return null;

  // Gemini "init" → system init
  if (eventType === 'init') {
    return {
      type: 'system',
      subtype: 'init',
      ...(typeof event.model === 'string' && { model: event.model }),
      permissionMode: 'bypassPermissions',
    };
  }

  // Gemini "message" → assistant or user based on role
  if (eventType === 'message') {
    const role = event.role as string | undefined;

    if (role === 'assistant') {
      return {
        type: 'assistant',
        message: { content: (event.content as string) || '' },
      };
    }

    if (role === 'user') {
      return { type: 'user', content: event.content };
    }

    // Tool messages
    if (role === 'tool') {
      return { type: 'tool_result', content: event.content };
    }

    // Default: treat as assistant
    return {
      type: 'assistant',
      message: { content: (event.content as string) || '' },
    };
  }

  // Gemini "tool_call" or "function_call" → tool_use
  if (eventType === 'tool_call' || eventType === 'function_call') {
    return {
      type: 'tool_use',
      name: (event.name as string) || (event.tool_name as string) || 'gemini_tool',
      input: (event.args as Record<string, unknown>) || (event.arguments as Record<string, unknown>) || (event.input as Record<string, unknown>),
    };
  }

  // Gemini "tool_result" or "function_response" → tool_result
  if (eventType === 'tool_result' || eventType === 'function_response') {
    return {
      type: 'tool_result',
      content: event.output || event.response || event.content,
    };
  }

  // Gemini "result" → result (with stats mapping)
  if (eventType === 'result') {
    const stats = event.stats as Record<string, unknown> | undefined;
    return {
      type: 'result',
      result: (event.content as string) || (event.status as string) || 'completed',
      total_cost_usd: 0,
      duration_ms: (stats?.duration_ms as number) || 0,
      subtype: (event.status as string) === 'success' ? 'success' : 'error',
    };
  }

  // Gemini "error" → assistant error
  if (eventType === 'error') {
    const message = (event.message as string) || (event.error as string) || 'Unknown Gemini error';
    let errorClassification: SDKAssistantMessageError = 'server_error';
    const lower = message.toLowerCase();
    if (lower.includes('rate limit') || lower.includes('429')) errorClassification = 'rate_limit';
    if (lower.includes('auth') || lower.includes('api key')) errorClassification = 'authentication_failed';
    if (lower.includes('quota') || lower.includes('billing')) errorClassification = 'billing_error';

    return {
      type: 'assistant',
      message: { content: message },
      error: errorClassification,
    };
  }

  // Direct passthrough for types that already match CLIMessage
  if (
    eventType === 'system' ||
    eventType === 'assistant' ||
    eventType === 'tool_progress' ||
    eventType === 'tool_use_summary'
  ) {
    return event as CLIMessage;
  }

  // Unknown event — pass through for logging
  return {
    type: 'tool_progress',
    ...event,
  };
}

function classifyProcessError(stderr: string, exitCode: number | null): SDKAssistantMessageError | null {
  const lower = stderr.toLowerCase();
  if (lower.includes('authentication') || lower.includes('api key') || lower.includes('unauthorized')) {
    return 'authentication_failed';
  }
  if (lower.includes('rate limit') || lower.includes('429')) return 'rate_limit';
  if (lower.includes('billing') || lower.includes('quota')) return 'billing_error';
  if (exitCode && exitCode > 0) return 'server_error';
  return null;
}

/**
 * Async generator that spawns Gemini CLI and yields CLIMessages.
 * Drop-in replacement for the Claude Code query() function.
 */
export async function* query(params: {
  prompt: string;
  options?: ClaudeCodeOptions;
}): AsyncGenerator<CLIMessage> {
  const { prompt, options = {} } = params;
  const args = buildArgs(prompt, options);
  const env = buildEnv(options);
  const geminiBin = resolveGeminiBinary();

  // Fix for Docker: host-mounted ~/.gemini/projects.json may contain Windows paths
  // that crash the Gemini CLI on Linux. Copy credentials to a writable temp directory
  // with a clean projects.json.
  try {
    const { mkdirSync, copyFileSync, existsSync } = await import('node:fs');
    const mountedGemini = join(process.env.HOME || '/tmp', '.gemini');
    const writableGemini = '/tmp/.gemini-runtime';
    mkdirSync(writableGemini, { recursive: true });
    // Copy credential files (skip projects.json which has Windows paths)
    for (const file of ['oauth_creds.json', 'settings.json', 'google_accounts.json', 'state.json', 'installation_id']) {
      const src = join(mountedGemini, file);
      if (existsSync(src)) copyFileSync(src, join(writableGemini, file));
    }
    // Write clean projects.json
    writeFileSync(join(writableGemini, 'projects.json'), '{"projects":{}}', 'utf8');
    // Point Gemini CLI to the clean directory
    env.HOME = '/tmp/.gemini-parent';
    mkdirSync('/tmp/.gemini-parent/.gemini', { recursive: true });
    for (const file of ['oauth_creds.json', 'settings.json', 'google_accounts.json', 'state.json', 'installation_id', 'projects.json']) {
      const src = join(writableGemini, file);
      if (existsSync(src)) copyFileSync(src, join('/tmp/.gemini-parent/.gemini', file));
    }
  } catch {
    // Ignore — if this fails, Gemini CLI will use the mounted directory as-is
  }

  let proc: ChildProcess;

  try {
    proc = spawn(geminiBin, args, {
      cwd: options.cwd || process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to spawn Gemini CLI: ${msg}. Is 'gemini' installed? (npm i -g @google/gemini-cli)`);
  }

  function cleanup(): void {
    if (proc && !proc.killed) proc.kill('SIGTERM');
  }

  // Close stdin immediately — Gemini may wait for stdin if it's a pipe
  proc.stdin?.end();

  let stderrBuffer = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
  });

  // Yield synthetic system init
  yield {
    type: 'system',
    subtype: 'init',
    model: options.model || 'gemini-2.5-flash',
    permissionMode: 'bypassPermissions',
  };

  const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });
  let lastResult: CLIMessage | null = null;

  // Gemini CLI can hang after tool calls — use an inactivity timeout to detect stalls
  const INACTIVITY_TIMEOUT_MS = 600_000; // 10 minutes of silence = stalled (Gemini sub-agents can take 3-5 min)
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  function resetInactivityTimer(): void {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      // Force-kill the stalled Gemini process
      cleanup();
      rl.close();
    }, INACTIVITY_TIMEOUT_MS);
  }

  resetInactivityTimer();

  try {
    for await (const line of rl) {
      resetInactivityTimer();
      const message = parseGeminiEvent(line);
      if (!message) continue;

      if (message.type === 'result') {
        lastResult = message;
      }

      yield message;
    }
  } finally {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    rl.close();
  }

  // Wait for process to exit
  const exitCode = await new Promise<number | null>((resolve) => {
    if (proc.exitCode !== null) {
      resolve(proc.exitCode);
      return;
    }
    proc.on('close', resolve);
    setTimeout(() => {
      cleanup();
      resolve(null);
    }, 30_000);
  });

  // If no result was yielded and process failed, synthesize one
  if (exitCode && exitCode > 0 && !lastResult) {
    const errorType = classifyProcessError(stderrBuffer, exitCode);
    if (errorType) {
      yield {
        type: 'assistant',
        message: { content: stderrBuffer || `Gemini CLI exited with code ${exitCode}` },
        error: errorType,
      };
    }

    yield {
      type: 'result' as const,
      total_cost_usd: 0,
      duration_ms: 0,
      subtype: 'error',
    };
  }
}
