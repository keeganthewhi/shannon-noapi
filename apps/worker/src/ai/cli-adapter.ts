/**
 * Generic CLI adapter interface and factory.
 *
 * Shannon supports multiple AI coding agent CLIs:
 * - claude  (Claude Code CLI — default)
 * - codex   (OpenAI Codex CLI)
 * - gemini  (Google Gemini CLI)
 *
 * Each adapter normalizes its CLI's JSONL output into the common CLIMessage format.
 * Selection via SHANNON_AGENT_CLI env var (default: "claude").
 */

import type { CLIMessage, ClaudeCodeOptions } from './claude-code-cli.js';

export type AgentCLIType = 'claude' | 'codex' | 'gemini';

/**
 * Resolve which CLI adapter to use.
 * Reads SHANNON_AGENT_CLI env var, defaults to "claude".
 */
export function resolveAgentCLI(): AgentCLIType {
  const cli = process.env.SHANNON_AGENT_CLI?.toLowerCase().trim();
  if (cli === 'codex') return 'codex';
  if (cli === 'gemini') return 'gemini';
  return 'claude';
}

/**
 * Factory: return the correct query() function for the configured CLI.
 */
export async function* query(params: {
  prompt: string;
  options?: ClaudeCodeOptions;
}): AsyncGenerator<CLIMessage> {
  const cli = resolveAgentCLI();

  switch (cli) {
    case 'codex': {
      const { query: codexQuery } = await import('./codex-cli.js');
      yield* codexQuery(params);
      break;
    }
    case 'gemini': {
      const { query: geminiQuery } = await import('./gemini-cli.js');
      yield* geminiQuery(params);
      break;
    }
    default: {
      const { query: claudeQuery } = await import('./claude-code-cli.js');
      yield* claudeQuery(params);
      break;
    }
  }
}
