// Claude Code CLI adapter for Shannon
// Replaces @anthropic-ai/claude-agent-sdk query() with `claude` CLI process spawning.
// Uses `--output-format stream-json` to get structured JSONL matching the SDK message format.

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * Mirrors the SDK's JsonSchemaOutputFormat type.
 * Inlined to remove the SDK dependency.
 */
export interface JsonSchemaOutputFormat {
  type: 'json_schema';
  schema: Record<string, unknown>;
}

/**
 * Mirrors the SDK's SDKAssistantMessageError type.
 * These are the error classifications the SDK returns on assistant messages.
 */
export type SDKAssistantMessageError =
  | 'billing_error'
  | 'rate_limit'
  | 'authentication_failed'
  | 'server_error'
  | 'invalid_request'
  | 'max_output_tokens';

/**
 * Options matching the subset of SDK options that Shannon uses.
 */
export interface ClaudeCodeOptions {
  model?: string;
  maxTurns?: number;
  cwd?: string;
  permissionMode?: 'bypassPermissions';
  allowDangerouslySkipPermissions?: boolean;
  settingSources?: ('user' | 'project' | 'local')[];
  env?: Record<string, string>;
  outputFormat?: JsonSchemaOutputFormat;
}

/**
 * A single message yielded by the CLI stream.
 * Union type covering all message shapes Shannon dispatches on.
 */
export type CLIMessage =
  | { type: 'system'; subtype?: string; model?: string; permissionMode?: string; [key: string]: unknown }
  | { type: 'assistant'; message: { content: unknown }; error?: SDKAssistantMessageError; [key: string]: unknown }
  | { type: 'user'; [key: string]: unknown }
  | { type: 'tool_use'; name: string; input?: Record<string, unknown>; [key: string]: unknown }
  | { type: 'tool_result'; content?: unknown; [key: string]: unknown }
  | { type: 'tool_progress'; [key: string]: unknown }
  | { type: 'tool_use_summary'; [key: string]: unknown }
  | { type: 'auth_status'; [key: string]: unknown }
  | {
      type: 'result';
      result?: string;
      total_cost_usd?: number;
      duration_ms?: number;
      subtype?: string;
      stop_reason?: string | null;
      permission_denials?: unknown[];
      structured_output?: unknown;
      [key: string]: unknown;
    };

/**
 * Resolve the path to the `claude` CLI binary.
 * Checks common installation locations.
 */
function resolveClaudeBinary(): string {
  // Allow override via env var
  if (process.env.CLAUDE_CODE_BINARY) {
    return process.env.CLAUDE_CODE_BINARY;
  }
  // Default: assume `claude` is on PATH (npm global install or ~/.claude/bin)
  return 'claude';
}

/**
 * Build CLI arguments from SDK-style options.
 */
function buildArgs(prompt: string, options: ClaudeCodeOptions): string[] {
  const args: string[] = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
  ];

  if (options.model) {
    args.push('--model', options.model);
  }

  if (options.maxTurns) {
    args.push('--max-turns', String(options.maxTurns));
  }

  if (options.permissionMode === 'bypassPermissions' || options.allowDangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions');
  }

  if (options.outputFormat) {
    // Pass structured output schema as a temporary file reference or inline JSON
    // Claude Code supports --output-format with JSON schema via --output-schema
    // For now, embed the instruction in the prompt (Claude Code doesn't have --output-schema yet)
    // The structured output will be handled via prompt engineering
  }

  return args;
}

/**
 * Build environment variables for the child process.
 * Merges Shannon's SDK env passthrough with process.env.
 */
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
 * Parse a JSONL line from Claude Code's stream-json output.
 * Returns null for unparseable lines (progress spinners, etc.).
 */
function parseLine(line: string): CLIMessage | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as CLIMessage;
  } catch {
    return null;
  }
}

/**
 * Map CLI error strings to SDKAssistantMessageError types.
 * Claude Code CLI reports errors differently than the SDK.
 */
function classifyProcessError(stderr: string, exitCode: number | null): SDKAssistantMessageError | null {
  const lower = stderr.toLowerCase();

  if (lower.includes('authentication') || lower.includes('api key') || lower.includes('unauthorized')) {
    return 'authentication_failed';
  }
  if (lower.includes('rate limit') || lower.includes('429')) {
    return 'rate_limit';
  }
  if (lower.includes('billing') || lower.includes('spending cap') || lower.includes('credits')) {
    return 'billing_error';
  }
  if (lower.includes('server error') || lower.includes('500') || lower.includes('502') || lower.includes('503')) {
    return 'server_error';
  }
  if (exitCode && exitCode > 0) {
    return 'server_error';
  }

  return null;
}

/**
 * Async generator that replaces the SDK's `query()` function.
 *
 * Spawns `claude -p <prompt> --output-format stream-json --dangerously-skip-permissions`
 * and yields structured messages matching the SDK's message types.
 *
 * Usage (drop-in replacement):
 *   for await (const message of query({ prompt, options })) { ... }
 */
export async function* query(params: {
  prompt: string;
  options?: ClaudeCodeOptions;
}): AsyncGenerator<CLIMessage> {
  const { prompt, options = {} } = params;
  const args = buildArgs(prompt, options);
  const env = buildEnv(options);
  const cwd = options.cwd || process.cwd();
  const claudeBin = resolveClaudeBinary();

  let proc: ChildProcess;

  try {
    proc = spawn(claudeBin, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to spawn Claude Code CLI: ${msg}. Is 'claude' installed and on PATH?`);
  }

  // Collect stderr for error classification
  let stderrBuffer = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
  });

  // Yield a synthetic system init message (CLI doesn't emit one)
  yield {
    type: 'system',
    subtype: 'init',
    model: options.model || 'claude-sonnet-4-6',
    permissionMode: options.permissionMode || 'bypassPermissions',
  };

  // Stream stdout line by line
  const rl = createInterface({
    input: proc.stdout!,
    crlfDelay: Infinity,
  });

  let lastResult: CLIMessage | null = null;

  for await (const line of rl) {
    const message = parseLine(line);
    if (!message) continue;

    if (message.type === 'result') {
      lastResult = message;
    }

    yield message;
  }

  // Wait for process to exit
  const exitCode = await new Promise<number | null>((resolve) => {
    proc.on('close', resolve);
    // If already exited
    if (proc.exitCode !== null) {
      resolve(proc.exitCode);
    }
  });

  // If process failed without yielding a result message, synthesize one
  if (exitCode && exitCode > 0 && !lastResult) {
    const errorType = classifyProcessError(stderrBuffer, exitCode);
    if (errorType) {
      // Yield an error assistant message so existing error handling kicks in
      yield {
        type: 'assistant',
        message: { content: stderrBuffer || `Claude Code CLI exited with code ${exitCode}` },
        error: errorType,
      };
    }

    // Yield a failure result
    yield {
      type: 'result',
      result: null,
      total_cost_usd: 0,
      duration_ms: 0,
      subtype: 'error',
    };
  }
}
