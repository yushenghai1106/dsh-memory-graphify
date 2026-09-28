/**
 * Resolved deployment facts and the parsed graph-element vocabulary of the
 * graphify-backed memory provider.
 * @module @deepseek-ai/dsh-memory-graphify/types
 */
/** Facts one provider instance is bound to at mount time. */
export interface GraphifySpec {
    /** Executable that runs graphify: its console script, or an interpreter such as `python`. */
    readonly command: string;
    /** Arguments placed before the graphify subcommand, e.g. `['-m', 'graphify']`. */
    readonly commandArgs: readonly string[];
    /**
     * Absolute path to the graph file this provider queries and extends. The
     * graph's directory also owns the memory documents and the lessons document,
     * and every invocation names these paths explicitly, so no call depends on
     * the harness process's working directory.
     */
    readonly graphPath: string;
    /** Traversal graphify uses to select the subgraph one query returns. */
    readonly traversal: 'bfs' | 'dfs';
    /** Approximate token budget graphify spends on one query result. */
    readonly tokenBudget: number;
    /** Bound on one graphify invocation in milliseconds. */
    readonly timeoutMs: number;
    /** Directory holding this graph's saved memory documents. */
    readonly memoryDir: string;
    /** Lessons document `graphify reflect` refreshes. */
    readonly lessonsPath: string;
    /** Number of prefetched query results the provider holds before dropping the oldest. */
    readonly prefetchCacheEntries: number;
}
/** One node or edge graphify returned for a query. */
export interface GraphifyElement {
    /** Verbatim render graphify produced for this element. */
    readonly line: string;
    /** Labels this element connects: both endpoints of an edge, or the node's own label. */
    readonly entities: readonly string[];
}
