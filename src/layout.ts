/**
 * The workspace layout graphify defines around one graph file. A provider
 * derives every path it reads or writes from these names, so no call depends on
 * the harness process's working directory.
 * @module @deepseek-ai/dsh-memory-graphify/layout
 */

/** Graph file graphify reads and writes inside an output directory. */
export const GRAPH_FILE_NAME = 'graph.json'

/** Directory graphify saves memory documents into, relative to the graph's directory. */
export const MEMORY_DIRECTORY_NAME = 'memory'

/** Directory graphify renders the lessons document into, relative to the graph's directory. */
export const LESSONS_DIRECTORY_NAME = 'reflections'

/** File name of the lessons document `graphify reflect` renders. */
export const LESSONS_FILE_NAME = 'LESSONS.md'
