/**
 * Command boundary over the graphify command line. The provider reads the
 * knowledge graph through `graphify query`, saves memory through
 * `graphify save-result`, refreshes the lessons overlay through
 * `graphify reflect`, and removes a saved memory document by matching the
 * question graphify wrote into its frontmatter. graphify owns the graph, its
 * extraction, and its document format; this module owns only argv, the document
 * lookup, and the parsing of one query render into graph elements.
 * @module @deepseek-ai/dsh-memory-graphify/client
 */
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command';
import type { GraphifyElement, GraphifySpec } from './types.js';
/** Failure raised for a graphify invocation that fails, times out, or is cancelled. */
export declare class GraphifyCliError extends Error {
    /**
     * @param message - operator-facing description naming the failing subcommand.
     */
    constructor(message: string);
}
/** One saved question/answer pair, as `graphify save-result` accepts it. */
export interface GraphifyMemory {
    /** Text graphify stores as the memory document's question. */
    readonly question: string;
    /** Text graphify stores as the memory document's answer. */
    readonly answer: string;
    /** Document type written to the frontmatter; the memory tool's target or a retained turn. */
    readonly type: string;
}
/** Runner over one graphify command line. */
export declare class GraphifyCli {
    private readonly spec;
    private readonly run;
    /**
     * @param spec - resolved executable, graph paths, traversal, and bounds.
     * @param run - injectable command boundary; defaults to the shell-free host runner.
     */
    constructor(spec: GraphifySpec, run?: NativeCommandRunner);
    /**
     * Query the knowledge graph from the seeds this question matches.
     * @param question - the question to traverse from.
     * @param signal - caller cancellation; aborts the invocation. Omitted by `prefetch`, which has no caller signal.
     * @returns graph elements in graphify's render order, empty when no seed node matched.
     */
    query(question: string, signal?: AbortSignal): Promise<readonly GraphifyElement[]>;
    /**
     * Save one question/answer pair as a memory document, which graphify's
     * extractor folds into the graph on its next update.
     * @param memory - the question, answer, and document type to persist.
     * @param signal - caller cancellation; aborts the invocation.
     */
    save(memory: GraphifyMemory, signal?: AbortSignal): Promise<void>;
    /**
     * Refresh the lessons overlay. graphify skips the rebuild while the document
     * is newer than every memory document, so this is a cheap read most turns.
     * @param signal - caller cancellation; aborts the invocation.
     */
    refreshLessons(signal?: AbortSignal): Promise<void>;
    /**
     * Delete every saved memory document whose question and type match.
     * graphify exposes no removal command, so the documents are matched through
     * the frontmatter graphify itself wrote them with.
     * @param question - exact question text the documents were saved under.
     * @param type - document type the documents were saved as.
     * @returns how many documents were deleted.
     */
    forget(question: string, type: string): Promise<number>;
    /**
     * Run one graphify subcommand and capture its standard output.
     * @param args - the subcommand and its arguments, appended to the configured prefix.
     * @param signal - caller cancellation; combined with the configured timeout.
     * @returns the captured standard output.
     */
    private invoke;
}
/**
 * Read the elements out of one `graphify query` render.
 * The render is a header line followed by one `NODE …` or `EDGE …` line per
 * element. A render over its token budget also carries a `[!]` or `[i]` notice
 * and a trailing `... (truncated …)` marker; neither names an element, and a
 * question that matched no seed node renders a header-less notice instead.
 * @param stdout - captured standard output of one `graphify query`.
 * @returns every named element in render order, empty when nothing matched.
 */
export declare function parseQueryResult(stdout: string): readonly GraphifyElement[];
