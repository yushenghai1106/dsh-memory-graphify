/**
 * graphify memory provider plugin: registers a `MemoryProvider` on
 * `ctx.memoryProviders` that reads a project's graphify knowledge graph and
 * writes retained entries back as memory documents graphify's extractor folds
 * into that graph. graphify owns the graph, its extraction, and its memory
 * documents; this plugin owns only the translation between the memory seam and
 * the graphify command line.
 * @module @deepseek-ai/dsh-memory-graphify
 */

import { dirname, isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Side-effect type import: declaration-merges `ctx.memoryProviders` onto Context.
import type {} from '@deepseek-ai/dsh-memory'
import { GraphifyCli } from './client.ts'
import { GraphifyMemoryProvider } from './provider.ts'
import {
  GRAPH_FILE_NAME,
  LESSONS_DIRECTORY_NAME,
  LESSONS_FILE_NAME,
  MEMORY_DIRECTORY_NAME,
} from './layout.ts'
import type { GraphifySpec } from './types.ts'

export { GraphifyCli, GraphifyCliError, parseQueryResult } from './client.ts'
export type { GraphifyMemory } from './client.ts'
export {
  GRAPH_FILE_NAME,
  LESSONS_DIRECTORY_NAME,
  LESSONS_FILE_NAME,
  MEMORY_DIRECTORY_NAME,
} from './layout.ts'
export { GRAPHIFY_PROVIDER_ID, GraphifyMemoryProvider } from './provider.ts'
export type { GraphifyElement, GraphifySpec } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'memory-graphify'

/** Service required before the provider can register. */
export const inject = ['memoryProviders']

/** Default executable that runs the graphify command line. */
export const DEFAULT_COMMAND = 'graphify'

/** Default graphify traversal for one query. */
export const DEFAULT_TRAVERSAL = 'bfs'

/** Default approximate token budget for one query result. */
export const DEFAULT_TOKEN_BUDGET = 2_000

/** Default bound on one graphify invocation in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 60_000

/** Default number of prefetched query results the provider holds. */
export const DEFAULT_PREFETCH_CACHE_ENTRIES = 8

/**
 * Plugin configuration. Every field is optional: {@link resolveSpec} fills the
 * documented default and validates the result, so a deployment states only what
 * differs from it.
 */
export interface Config {
  /** Executable that runs graphify: its console script, or an interpreter such as `python`. */
  command?: string
  /** Arguments placed before the graphify subcommand, e.g. `['-m', 'graphify']`. */
  commandArgs?: string[]
  /** Absolute path to the `graph.json` holding the graph this provider reads and extends. */
  graphPath?: string
  /** Traversal graphify uses to select the subgraph one query returns. */
  traversal?: 'bfs' | 'dfs'
  /** Approximate token budget graphify spends on one query result. */
  tokenBudget?: number
  /** Bound on one graphify invocation in milliseconds. */
  timeoutMs?: number
  /** Number of prefetched query results the provider holds before dropping the oldest. */
  prefetchCacheEntries?: number
}

export const Config: z<Config> = z.object({
  command: z.string(),
  commandArgs: z.array(z.string()),
  graphPath: z.string(),
  traversal: z.union(['bfs', 'dfs'] as const),
  tokenBudget: z.number().step(1).min(1),
  timeoutMs: z.number().step(1).min(1),
  prefetchCacheEntries: z.number().step(1).min(1),
})

/**
 * Resolve configuration into the facts one provider instance is bound to.
 * The graph's directory owns the memory documents and the lessons document, so
 * one absolute graph path fixes the whole layout graphify itself defines.
 * @param config - plugin configuration loaded from `cordis.yml`.
 * @returns the validated executable, graph paths, traversal, and bounds.
 */
export function resolveSpec(config: Config): GraphifySpec {
  const graphPath = config.graphPath
  if (graphPath === undefined || graphPath.trim() === '') {
    throw new Error('memory-graphify: graphPath must name the graphify graph.json to query (set GRAPHIFY_GRAPH_PATH for the installed bundle)')
  }
  if (!isAbsolute(graphPath)) {
    throw new Error(`memory-graphify: graphPath '${graphPath}' must be absolute; graphify resolves relative paths against the process working directory`)
  }
  if (!graphPath.endsWith(GRAPH_FILE_NAME)) {
    throw new Error(`memory-graphify: graphPath '${graphPath}' must name the '${GRAPH_FILE_NAME}' graphify writes`)
  }

  const command = config.command ?? DEFAULT_COMMAND
  if (command.trim() === '') throw new Error('memory-graphify: command must not be blank')

  const graphDirectory = dirname(graphPath)
  return {
    command,
    commandArgs: config.commandArgs ?? [],
    graphPath,
    traversal: config.traversal ?? DEFAULT_TRAVERSAL,
    tokenBudget: positiveInteger('tokenBudget', config.tokenBudget ?? DEFAULT_TOKEN_BUDGET),
    timeoutMs: positiveInteger('timeoutMs', config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    memoryDir: join(graphDirectory, MEMORY_DIRECTORY_NAME),
    lessonsPath: join(graphDirectory, LESSONS_DIRECTORY_NAME, LESSONS_FILE_NAME),
    prefetchCacheEntries: positiveInteger('prefetchCacheEntries', config.prefetchCacheEntries ?? DEFAULT_PREFETCH_CACHE_ENTRIES),
  }
}

/**
 * Register the graphify provider with `ctx.memoryProviders`.
 * @param ctx - plugin context carrying the memory provider registry.
 * @param config - plugin configuration loaded from `cordis.yml`.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const spec = resolveSpec(config)
  const provider = new GraphifyMemoryProvider(new GraphifyCli(spec), spec.prefetchCacheEntries)
  ctx.effect(() => ctx.memoryProviders.register(provider), 'memory-graphify.provider')
}

/**
 * Reject a configuration value that must be a positive whole number.
 * @param field - configuration field name, used in the diagnostic.
 * @param value - configured value.
 * @returns the accepted value.
 */
function positiveInteger(field: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`memory-graphify: ${field} '${String(value)}' must be a positive whole number`)
  }
  return value
}
