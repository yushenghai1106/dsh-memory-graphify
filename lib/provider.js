/**
 * graphify-backed long-term memory: recall traverses the project's knowledge
 * graph for the current question, retention saves question/answer documents
 * that graphify's extractor folds into that graph, and prefetch runs the query
 * a matching recall will ask for.
 * @module @deepseek-ai/dsh-memory-graphify/provider
 */
import { createHash } from 'node:crypto';
/** Provider id `dsh-tool-memory` selects through its `provider` setting. */
export const GRAPHIFY_PROVIDER_ID = 'graphify';
/** Document type recorded for an automatically retained exchange. */
const TURN_TYPE = 'turn';
/** Prefix of the identifier a recalled graph element is reported under. */
const FACT_ID_PREFIX = 'graphify:';
/** Hex characters of the element digest kept in a fact identifier. */
const FACT_ID_DIGEST_LENGTH = 16;
/** graphify-backed long-term memory over one knowledge graph. */
export class GraphifyMemoryProvider {
    cli;
    prefetchCacheEntries;
    /** Selected by `dsh-tool-memory`'s `provider` setting. */
    id = GRAPHIFY_PROVIDER_ID;
    prefetched = new Map();
    /**
     * @param cli - command boundary over graphify.
     * @param prefetchCacheEntries - how many prefetched results to hold before the oldest is dropped.
     */
    constructor(cli, prefetchCacheEntries) {
        this.cli = cli;
        this.prefetchCacheEntries = prefetchCacheEntries;
    }
    /**
     * Refresh the lessons overlay and run the query a matching recall will ask
     * for, so that call does not wait for graphify. A failure is dropped on
     * purpose: this call has no caller to report to and no signal to honour, and
     * `recall` runs the same query again and raises the failure there.
     * @param query - the question the next model request will ask.
     */
    async prefetch(query) {
        try {
            await this.prepare(query);
        }
        catch {
            // Swallow: the failure surfaces from `recall`, which has a caller.
        }
    }
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
    async recall(query, limit, signal) {
        signal.throwIfAborted();
        const elements = this.take(query) ?? await this.cli.query(query, signal);
        const retainedAt = new Date().toISOString();
        return rank(elements)
            .slice(0, Math.max(0, limit))
            .map(element => ({ fact: factOf(element, retainedAt), score: 1 }));
    }
    /**
     * Save one completed exchange as a memory document.
     * @param input - user prompt and final assistant response of the completed turn.
     */
    async retain(input) {
        await this.cli.save({ question: input.user, answer: input.assistant, type: TURN_TYPE });
    }
    /**
     * Save one curated entry as a memory document of its target's type.
     * graphify stores every memory document as a question and its answer, so a
     * curated entry that has no answer stands in for both fields and the document
     * type carries the target.
     * @param target - `memory` for project facts, `user` for user preferences.
     * @param content - curated entry text.
     */
    async retainTool(target, content) {
        await this.cli.save({ question: content, answer: content, type: target });
    }
    /**
     * Delete every memory document this provider saved for one curated entry.
     * The graph keeps the deleted document's extraction until a graphify run
     * outside this plugin updates it, so a forgotten entry can stay reachable
     * through the graph data itself.
     * @param target - `memory` for project facts, `user` for user preferences.
     * @param content - exact curated entry text to remove.
     */
    async forgetTool(target, content) {
        await this.cli.forget(content, target);
    }
    /** Do the work `prefetch` performs, in one operation so its caller has a single statement to guard. */
    async prepare(query) {
        await this.cli.refreshLessons();
        this.remember(query, await this.cli.query(query));
    }
    /** Hold one prefetched result, refreshing its position and dropping the oldest entry when full. */
    remember(query, elements) {
        this.prefetched.delete(query);
        this.prefetched.set(query, elements);
        if (this.prefetched.size <= this.prefetchCacheEntries)
            return;
        // The cache bound is at least one, so a map over its bound still holds the entry to drop.
        const oldest = this.prefetched.keys().next().value;
        this.prefetched.delete(oldest);
    }
    /** Consume the prefetched result for one question, so a later recall runs the query again. */
    take(query) {
        const elements = this.prefetched.get(query);
        this.prefetched.delete(query);
        return elements;
    }
}
/** Order elements so relational facts come first, preserving graphify's order within each group. */
function rank(elements) {
    const edges = elements.filter(element => element.entities.length === 2);
    const nodes = elements.filter(element => element.entities.length !== 2);
    return [...edges, ...nodes];
}
/**
 * Project one graph element into the provider-neutral fact vocabulary.
 * A graph element is neither a retained exchange nor owned by this provider,
 * and the graph records no per-element retention time, so `turn` marks its
 * accumulated origin and the recall timestamp stands in for that time.
 * @param element - one element of a query result.
 * @param retainedAt - recall timestamp recorded on the fact.
 * @returns the fact a memory consumer renders or ranks.
 */
function factOf(element, retainedAt) {
    return {
        id: `${FACT_ID_PREFIX}${createHash('sha1').update(element.line).digest('hex').slice(0, FACT_ID_DIGEST_LENGTH)}`,
        content: element.line,
        entities: [...element.entities],
        retainedAt,
        source: 'turn',
    };
}
