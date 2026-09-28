/**
 * graphify memory provider plugin: registers a `MemoryProvider` on
 * `ctx.memoryProviders` that reads a project's graphify knowledge graph and
 * writes retained entries back as memory documents graphify's extractor folds
 * into that graph. graphify owns the graph, its extraction, and its memory
 * documents; this plugin owns only the translation between the memory seam and
 * the graphify command line.
 * @module @deepseek-ai/dsh-memory-graphify
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { GraphifySpec } from './types.js';
export { GraphifyCli, GraphifyCliError, parseQueryResult } from './client.js';
export type { GraphifyMemory } from './client.js';
export { GRAPH_FILE_NAME, LESSONS_DIRECTORY_NAME, LESSONS_FILE_NAME, MEMORY_DIRECTORY_NAME, } from './layout.js';
export { GRAPHIFY_PROVIDER_ID, GraphifyMemoryProvider } from './provider.js';
export type { GraphifyElement, GraphifySpec } from './types.js';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "memory-graphify";
/** Service required before the provider can register. */
export declare const inject: string[];
/** Default executable that runs the graphify command line. */
export declare const DEFAULT_COMMAND = "graphify";
/** Default graphify traversal for one query. */
export declare const DEFAULT_TRAVERSAL = "bfs";
/** Default approximate token budget for one query result. */
export declare const DEFAULT_TOKEN_BUDGET = 2000;
/** Default bound on one graphify invocation in milliseconds. */
export declare const DEFAULT_TIMEOUT_MS = 60000;
/** Default number of prefetched query results the provider holds. */
export declare const DEFAULT_PREFETCH_CACHE_ENTRIES = 8;
/**
 * Plugin configuration. Every field is optional: {@link resolveSpec} fills the
 * documented default and validates the result, so a deployment states only what
 * differs from it.
 */
export interface Config {
    /** Executable that runs graphify: its console script, or an interpreter such as `python`. */
    command?: string;
    /** Arguments placed before the graphify subcommand, e.g. `['-m', 'graphify']`. */
    commandArgs?: string[];
    /** Absolute path to the `graph.json` holding the graph this provider reads and extends. */
    graphPath?: string;
    /** Traversal graphify uses to select the subgraph one query returns. */
    traversal?: 'bfs' | 'dfs';
    /** Approximate token budget graphify spends on one query result. */
    tokenBudget?: number;
    /** Bound on one graphify invocation in milliseconds. */
    timeoutMs?: number;
    /** Number of prefetched query results the provider holds before dropping the oldest. */
    prefetchCacheEntries?: number;
}
export declare const Config: z<Config>;
/**
 * Resolve configuration into the facts one provider instance is bound to.
 * The graph's directory owns the memory documents and the lessons document, so
 * one absolute graph path fixes the whole layout graphify itself defines.
 * @param config - plugin configuration loaded from `cordis.yml`.
 * @returns the validated executable, graph paths, traversal, and bounds.
 */
export declare function resolveSpec(config: Config): GraphifySpec;
/**
 * Register the graphify provider with `ctx.memoryProviders`.
 * @param ctx - plugin context carrying the memory provider registry.
 * @param config - plugin configuration loaded from `cordis.yml`.
 */
export declare function apply(ctx: Context, config?: Config): void;
