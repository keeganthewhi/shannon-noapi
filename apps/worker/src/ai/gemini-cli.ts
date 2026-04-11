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
import { appendFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import type { CLIMessage, ClaudeCodeOptions, SDKAssistantMessageError } from './claude-code-cli.js';

/**
 * Debug helper: dump raw Gemini JSONL events to a file when GEMINI_DEBUG_DUMP
 * is set. Makes it possible to reverse-engineer Gemini's actual stream-json
 * schema without having to modify the adapter and rebuild every time.
 */
function dumpRawEvent(line: string): void {
  const dumpPath = process.env.GEMINI_DEBUG_DUMP;
  if (!dumpPath) return;
  try {
    appendFileSync(dumpPath, `${line}\n`, 'utf8');
  } catch {
    // Silent — debug only
  }
}

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
 * The real Gemini stream-json schema (from @google/gemini-cli's
 * stream-json-formatter and the emitEvent call sites in gemini.js) is:
 *
 *   {"type":"init",        "timestamp", "session_id", "model"}
 *   {"type":"message",     "timestamp", "role", "content", "delta"}
 *   {"type":"tool_use",    "timestamp", "tool_name", "tool_id", "parameters"}
 *   {"type":"tool_result", "timestamp", "tool_id", "status", "output", "error"}
 *   {"type":"error",       "timestamp", "severity", "message"}
 *   {"type":"result",      "timestamp", "status", "stats", "error"}
 *
 * Earlier versions of this adapter assumed Claude-like field names
 * (`name`, `args`/`arguments`/`input`, etc.), which silently dropped
 * every tool_use and tool_result because none of those keys exist on
 * Gemini events. The result was empty parameters in every agent log
 * and validator rejections despite successful tool execution.
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
    const content = (event.content as string) ?? '';

    if (role === 'user') {
      return { type: 'user', content };
    }

    // Assistant (and any other role that isn't user) — Gemini emits delta
    // chunks as role="assistant" with delta:true. Shannon's message handler
    // concatenates the content field across turns, so pass it through as-is.
    return {
      type: 'assistant',
      message: { content },
    };
  }

  // Gemini "tool_use" — the REAL tool call event (not "tool_call"/"function_call").
  // Shannon's CLIMessage type name collides with Gemini's type string, which is
  // fine — we're normalizing both onto the same shape.
  if (eventType === 'tool_use') {
    const parameters = (event.parameters as Record<string, unknown>) ?? {};
    return {
      type: 'tool_use',
      name: (event.tool_name as string) || 'gemini_tool',
      input: parameters,
      ...(typeof event.tool_id === 'string' && { tool_id: event.tool_id }),
    };
  }

  // Gemini "tool_result" — Shannon's handler reads the `content` field, so
  // synthesize that from `output`/`error` and preserve the status for logging.
  if (eventType === 'tool_result') {
    const status = event.status as string | undefined;
    const output = event.output;
    const errorInfo = event.error as { message?: string; type?: string } | undefined;

    let content: unknown;
    if (status === 'error' && errorInfo) {
      content = `[${errorInfo.type || 'TOOL_ERROR'}] ${errorInfo.message || 'Tool execution failed'}`;
    } else if (output !== undefined && output !== null) {
      content = output;
    } else {
      // Empty-output success — common for side-effect tools like Write, Edit, Bash
      // (when the command produced no stdout). Represent as an empty string so
      // downstream stringification doesn't explode on undefined.
      content = '';
    }

    return {
      type: 'tool_result',
      content,
      ...(typeof event.tool_id === 'string' && { tool_id: event.tool_id }),
      ...(status && { status }),
    };
  }

  // Gemini "result" → final result with stats. Stats carry the duration and
  // tool-call counts; we surface them in the result message and map status.
  if (eventType === 'result') {
    const stats = event.stats as Record<string, unknown> | undefined;
    const status = event.status as string | undefined;
    const errorInfo = event.error as { message?: string } | undefined;

    return {
      type: 'result',
      result: errorInfo?.message || status || 'completed',
      total_cost_usd: 0,
      duration_ms: (stats?.duration_ms as number) || 0,
      subtype: status === 'success' ? 'success' : 'error',
    };
  }

  // Gemini "error" → assistant error with classified reason
  if (eventType === 'error') {
    const message = (event.message as string) || 'Unknown Gemini error';
    let errorClassification: SDKAssistantMessageError = 'server_error';
    const lower = message.toLowerCase();
    if (lower.includes('rate limit') || lower.includes('429') || lower.includes('quota')) errorClassification = 'rate_limit';
    if (lower.includes('exhausted') || lower.includes('billing')) errorClassification = 'billing_error';
    if (lower.includes('auth') || lower.includes('api key') || lower.includes('unauthorized')) errorClassification = 'authentication_failed';

    return {
      type: 'assistant',
      message: { content: message },
      error: errorClassification,
    };
  }

  // Unknown event — return a tool_progress wrapper so it shows up in logs
  // WITHOUT letting event.type overwrite the wrapper type via spread-order.
  return {
    ...event,
    type: 'tool_progress',
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
  let lastAssistantContent = '';

  // Gemini CLI can hang after tool calls — use an inactivity timeout to detect stalls
  const INACTIVITY_TIMEOUT_MS = 1_800_000; // 30 minutes — Gemini sub-agents produce no stdout during execution
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
      dumpRawEvent(line);
      const message = parseGeminiEvent(line);
      if (!message) continue;

      if (message.type === 'result') {
        lastResult = message;
      } else if (message.type === 'assistant' && 'message' in message) {
        const content = (message as { message: { content: unknown } }).message.content;
        if (typeof content === 'string' && content.trim().length > 0) {
          lastAssistantContent = content;
        }
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

  // Synthesize a final result message if Gemini didn't emit one. Gemini CLI
  // does not reliably emit a `result` event on every successful run —
  // particularly when the LLM produces a short final assistant message and
  // exits cleanly. Without a synthesized result Shannon's processMessageStream
  // leaves `result = null`, which then trips validateAgentOutput's
  // `!result.result` check and deletes the deliverable during rollback.
  // Always yield SOMETHING Shannon can treat as a completion signal.
  if (!lastResult) {
    const processFailed = exitCode !== 0 && exitCode !== null;

    if (processFailed) {
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
        result: stderrBuffer || `Gemini CLI exited with code ${exitCode}`,
        total_cost_usd: 0,
        duration_ms: 0,
        subtype: 'error',
      };
    } else {
      // Clean exit without a result event — synthesize a success result using
      // the most recent meaningful assistant content as the completion signal.
      yield {
        type: 'result' as const,
        result: lastAssistantContent || 'Gemini execution completed',
        total_cost_usd: 0,
        duration_ms: 0,
        subtype: 'success',
      };
    }
  }
}
