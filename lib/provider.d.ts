/**
 * graphify-backed long-term memory: recall traverses the project's knowledge
 * graph for the current question, retention saves question/answer documents
 * that graphify's extractor folds into that graph, and prefetch runs the query
 * a matching recall will ask for.
 * @module @deepseek-ai/dsh-memory-graphify/provider
 */
import type { MemoryProvider, MemoryRecall, MemoryRetention } from '@deepseek-ai/dsh-memory';
import type { GraphifyCli } from './client.js';
/** Provider id `dsh-tool-memory` selects through its `provider` setting. */
export declare const GRAPHIFY_PROVIDER_ID = "graphify";
/** graphify-backed long-term memory over one knowledge graph. */
export declare class GraphifyMemoryProvider implements MemoryProvider {
    private readonly cli;
    private readonly prefetchCacheEntries;
    /** Selected by `dsh-tool-memory`'s `provider` setting. */
    readonly id = "graphify";
    private readonly prefetched;
    /**
     * @param cli - command boundary over graphify.
     * @param prefetchCacheEntries - how many prefetched results to hold before the oldest is dropped.
     */
    constructor(cli: GraphifyCli, prefetchCacheEntries: number);
    /**
     * Refresh the lessons overlay and run the query a matching recall will ask
     * for, so that call does not wait for graphify. A failure is dropped on
     * purpose: this call has no caller to report to and no signal to honour, and
     * `recall` runs the same query again and raises the failure there.
     * @param query - the question the next model request will ask.
     */
    prefetch(query: string): Promise<void>;
    /**
     * Recall the graph elements the current question reaches.
     * Every element the traversal selected is equally relevant, so each recalled
     * fact scores 1. Edges come before nodes: a recalled line is only useful when
     * it carries the relation the question asked about, and the memory consumer's
     * `limit` cuts from the tail.
     * @param query - the current question.
     * @param limit - maximum number of facts to return.
     * @param signal - caller cancellation; aborts the graphify invocation.
     * @returns recalled facts, empty when graphify matched no seed node.
     */
    recall(query: string, limit: number, signal: AbortSignal): Promise<readonly MemoryRecall[]>;
    /**
     * Save one completed exchange as a memory document.
     * @param input - user prompt and final assistant response of the completed turn.
     */
    retain(input: MemoryRetention): Promise<void>;
    /**
     * Save one curated entry as a memory document of its target's type.
     * graphify stores every memory document as a question and its answer, so a
     * curated entry that has no answer stands in for both fields and the document
     * type carries the target.
     * @param target - `memory` for project facts, `user` for user preferences.
     * @param content - curated entry text.
     */
    retainTool(target: 'memory' | 'user', content: string): Promise<void>;
    /**
     * Delete every memory document this provider saved for one curated entry.
     * The graph keeps the deleted document's extraction until a graphify run
     * outside this plugin updates it, so a forgotten entry can stay reachable
     * through the graph data itself.
     * @param target - `memory` for project facts, `user` for user preferences.
     * @param content - exact curated entry text to remove.
     */
    forgetTool(target: 'memory' | 'user', content: string): Promise<void>;
    /** Do the work `prefetch` performs, in one operation so its caller has a single statement to guard. */
    private prepare;
    /** Hold one prefetched result, refreshing its position and dropping the oldest entry when full. */
    private remember;
    /** Consume the prefetched result for one question, so a later recall runs the query again. */
    private take;
}
