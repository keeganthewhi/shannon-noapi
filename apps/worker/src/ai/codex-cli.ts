/**
 * OpenAI Codex CLI adapter for Shannon.
 *
 * Spawns `codex exec --json --dangerously-bypass-approvals-and-sandbox` and
 * normalizes Codex JSONL events into Shannon's CLIMessage format.
 *
 * Codex event types:
 *   thread.started  → system init
 *   turn.started    → (ignored, internal)
 *   turn.completed  → assistant message
 *   item.*          → tool_use / tool_result depending on item type
 *   error           → assistant error
 *   (final output)  → result
 *
 * Set CODEX_BINARY env var to override the `codex` binary path.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { CLIMessage, ClaudeCodeOptions, SDKAssistantMessageError } from './claude-code-cli.js';

function resolveCodexBinary(): string {
  return process.env.CODEX_BINARY || 'codex';
}

function buildArgs(prompt: string, options: ClaudeCodeOptions): string[] {
  const args: string[] = [
    'exec',
    '--json',
    '--dangerously-bypass-approvals-and-sandbox',
    '--skip-git-repo-check',
  ];

  // Only pass --model if it's an OpenAI model (not Anthropic defaults)
  if (options.model && !options.model.startsWith('claude-')) {
    args.push('--model', options.model);
  }

  if (options.cwd) {
    args.push('--cd', options.cwd);
  }

  // Prompt is the last positional argument
  args.push(prompt);

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
 * Parse a Codex JSONL line into a Shannon CLIMessage.
 * Normalizes Codex event types to match Claude Code's format.
 */
function parseCodexEvent(line: string): CLIMessage | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) return null;

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }

  const eventType = event.type as string | undefined;

  // thread.started → system init
  if (eventType === 'thread.started') {
    return {
      type: 'system',
      subtype: 'init',
      ...((event.model as string) && { model: event.model as string }),
      permissionMode: 'bypassPermissions',
    };
  }

  // turn.completed → assistant message (contains usage stats)
  if (eventType === 'turn.completed') {
    return {
      type: 'assistant',
      message: { content: '' },
    };
  }

  // turn.failed → error
  if (eventType === 'turn.failed') {
    const errorObj = event.error as Record<string, unknown> | undefined;
    const message = (errorObj?.message as string) || 'Codex turn failed';
    let errorType: SDKAssistantMessageError = 'server_error';
    const lower = message.toLowerCase();
    if (lower.includes('rate limit') || lower.includes('429')) errorType = 'rate_limit';
    if (lower.includes('not supported') || lower.includes('invalid')) errorType = 'invalid_request';
    if (lower.includes('auth') || lower.includes('api key')) errorType = 'authentication_failed';

    return {
      type: 'assistant',
      message: { content: message },
      error: errorType,
    };
  }

  // item.completed — the main event type. Contains an "item" object with type field
  if (eventType === 'item.completed') {
    const item = event.item as Record<string, unknown> | undefined;
    if (!item) return null;

    const itemType = item.type as string | undefined;

    // Agent message (text response)
    if (itemType === 'agent_message' || itemType === 'message') {
      return {
        type: 'assistant',
        message: { content: (item.text as string) || (item.content as string) || '' },
      };
    }

    // Function/tool call
    if (itemType === 'function_call' || itemType === 'tool_call') {
      return {
        type: 'tool_use',
        name: (item.name as string) || 'codex_tool',
        input: (item.arguments as Record<string, unknown>) || (item.input as Record<string, unknown>),
      };
    }

    // Function/tool output
    if (itemType === 'function_call_output' || itemType === 'tool_output') {
      return {
        type: 'tool_result',
        content: item.output || item.text,
      };
    }

    // Command execution
    if (itemType === 'command' || itemType === 'local_shell_call') {
      return {
        type: 'tool_use',
        name: 'bash',
        input: { command: (item.command as string) || (item.call_id as string) || '' },
      };
    }

    // Command output
    if (itemType === 'local_shell_call_output') {
      return {
        type: 'tool_result',
        content: item.output || item.text,
      };
    }

    // Other item types — pass through
    return { type: 'tool_progress', ...event };
  }

  // item.created — early notification, can ignore or use as tool_progress
  if (eventType === 'item.created') {
    return null; // Skip — item.completed has the full data
  }

  // error event
  if (eventType === 'error') {
    const message = (event.message as string) || (event.error as string) || 'Unknown Codex error';
    let errorType: SDKAssistantMessageError = 'server_error';
    const lower = message.toLowerCase();
    if (lower.includes('rate limit') || lower.includes('429')) errorType = 'rate_limit';
    if (lower.includes('auth') || lower.includes('api key')) errorType = 'authentication_failed';
    if (lower.includes('billing') || lower.includes('quota')) errorType = 'billing_error';

    return {
      type: 'assistant',
      message: { content: message },
      error: errorType,
    };
  }

  // turn.started — ignore (internal bookkeeping)
  if (eventType === 'turn.started') return null;

  // Unknown event — pass through for logging
  return { type: 'tool_progress', ...event };
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
 * Async generator that spawns Codex CLI and yields CLIMessages.
 * Drop-in replacement for the Claude Code query() function.
 */
export async function* query(params: {
  prompt: string;
  options?: ClaudeCodeOptions;
}): AsyncGenerator<CLIMessage> {
  const { prompt, options = {} } = params;
  const args = buildArgs(prompt, options);
  const env = buildEnv(options);
  const codexBin = resolveCodexBinary();

  let proc: ChildProcess;

  try {
    proc = spawn(codexBin, args, {
      cwd: options.cwd || process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to spawn Codex CLI: ${msg}. Is 'codex' installed? (npm i -g @openai/codex)`);
  }

  function cleanup(): void {
    if (proc && !proc.killed) proc.kill('SIGTERM');
  }

  // Close stdin immediately — Codex waits for stdin if it's a pipe
  proc.stdin?.end();

  let stderrBuffer = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
  });

  // Yield synthetic system init (in case Codex doesn't emit thread.started)
  yield {
    type: 'system',
    subtype: 'init',
    model: options.model || 'gpt-5.2',
    permissionMode: 'bypassPermissions',
  };

  const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });
  let lastResult: CLIMessage | null = null;
  let lastAssistantContent = '';

  try {
    for await (const line of rl) {
      const message = parseCodexEvent(line);
      if (!message) continue;

      if (message.type === 'assistant' && 'message' in message) {
        lastAssistantContent = String((message as { message: { content: unknown } }).message.content || '');
      }

      yield message;
    }
  } finally {
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

  // Synthesize a result message (Codex doesn't emit one in CLIMessage format)
  yield {
    type: 'result' as const,
    result: lastAssistantContent || 'Codex execution completed',
    total_cost_usd: 0,
    duration_ms: 0,
    subtype: exitCode === 0 ? 'success' : 'error',
  };

  // If process failed, also yield an error
  if (exitCode && exitCode > 0 && !lastResult) {
    const errorType = classifyProcessError(stderrBuffer, exitCode);
    if (errorType) {
      yield {
        type: 'assistant',
        message: { content: stderrBuffer || `Codex CLI exited with code ${exitCode}` },
        error: errorType,
      };
    }
  }
}
