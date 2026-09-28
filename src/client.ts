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

import { readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { runNativeCommand } from '@deepseek-ai/dsh-native-command'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import type { GraphifyElement, GraphifySpec } from './types.ts'

/** Failure raised for a graphify invocation that fails, times out, or is cancelled. */
export class GraphifyCliError extends Error {
  /**
   * @param message - operator-facing description naming the failing subcommand.
   */
  constructor(message: string) {
    super(message)
    this.name = 'GraphifyCliError'
  }
}

/** Prefix graphify renders one graph node line with. */
const NODE_PREFIX = 'NODE '

/** Prefix graphify renders one graph edge line with. */
const EDGE_PREFIX = 'EDGE '

/** Marker starting an edge's relation, before its confidence bracket. */
const EDGE_RELATION_MARKER = ' --'

/** Marker ending an edge's confidence bracket, before its target label. */
const EDGE_TERMINATOR = ']--> '

/** Marker starting an edge's relation site, after its target label. */
const EDGE_SITE_MARKER = ' at='

/** Frontmatter field holding the question graphify saved a memory document under. */
const QUESTION_FIELD = /^question: "((?:[^"\\]|\\.)*)"$/mu

/** Frontmatter field holding the memory document's type. */
const TYPE_FIELD = /^type: "((?:[^"\\]|\\.)*)"$/mu

/** Suffix of every saved memory document. */
const MEMORY_SUFFIX = '.md'

/** YAML double-quoted escapes graphify's writer emits, by escaped character. */
const ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\',
  '"': '"',
  n: '\n',
  r: '\r',
  t: '\t',
  0: '\0',
  L: '\u2028',
  P: '\u2029',
}

/** One saved question/answer pair, as `graphify save-result` accepts it. */
export interface GraphifyMemory {
  /** Text graphify stores as the memory document's question. */
  readonly question: string
  /** Text graphify stores as the memory document's answer. */
  readonly answer: string
  /** Document type written to the frontmatter; the memory tool's target or a retained turn. */
  readonly type: string
}

/** Runner over one graphify command line. */
export class GraphifyCli {
  /**
   * @param spec - resolved executable, graph paths, traversal, and bounds.
   * @param run - injectable command boundary; defaults to the shell-free host runner.
   */
  constructor(private readonly spec: GraphifySpec, private readonly run: NativeCommandRunner = runNativeCommand) {}

  /**
   * Query the knowledge graph from the seeds this question matches.
   * @param question - the question to traverse from.
   * @param signal - caller cancellation; aborts the invocation. Omitted by `prefetch`, which has no caller signal.
   * @returns graph elements in graphify's render order, empty when no seed node matched.
   */
  async query(question: string, signal?: AbortSignal): Promise<readonly GraphifyElement[]> {
    const stdout = await this.invoke('query', [
      question,
      ...this.spec.traversal === 'dfs' ? ['--dfs'] : [],
      '--budget', String(this.spec.tokenBudget),
      '--graph', this.spec.graphPath,
    ], signal)
    return parseQueryResult(stdout)
  }

  /**
   * Save one question/answer pair as a memory document, which graphify's
   * extractor folds into the graph on its next update.
   * @param memory - the question, answer, and document type to persist.
   * @param signal - caller cancellation; aborts the invocation.
   */
  async save(memory: GraphifyMemory, signal?: AbortSignal): Promise<void> {
    await this.invoke('save-result', [
      '--question', memory.question,
      '--answer', memory.answer,
      '--type', memory.type,
      '--memory-dir', this.spec.memoryDir,
    ], signal)
  }

  /**
   * Refresh the lessons overlay. graphify skips the rebuild while the document
   * is newer than every memory document, so this is a cheap read most turns.
   * @param signal - caller cancellation; aborts the invocation.
   */
  async refreshLessons(signal?: AbortSignal): Promise<void> {
    await this.invoke('reflect', [
      '--if-stale',
      '--memory-dir', this.spec.memoryDir,
      '--out', this.spec.lessonsPath,
      '--graph', this.spec.graphPath,
    ], signal)
  }

  /**
   * Delete every saved memory document whose question and type match.
   * graphify exposes no removal command, so the documents are matched through
   * the frontmatter graphify itself wrote them with.
   * @param question - exact question text the documents were saved under.
   * @param type - document type the documents were saved as.
   * @returns how many documents were deleted.
   */
  async forget(question: string, type: string): Promise<number> {
    let deleted = 0
    for (const name of await readDirectory(this.spec.memoryDir)) {
      if (!name.endsWith(MEMORY_SUFFIX)) continue
      const path = join(this.spec.memoryDir, name)
      const document = await readFile(path, 'utf8')
      if (readField(QUESTION_FIELD, document) !== question) continue
      if (readField(TYPE_FIELD, document) !== type) continue
      await rm(path)
      deleted += 1
    }
    return deleted
  }

  /**
   * Run one graphify subcommand and capture its standard output.
   * @param args - the subcommand and its arguments, appended to the configured prefix.
   * @param signal - caller cancellation; combined with the configured timeout.
   * @returns the captured standard output.
   */
  private async invoke(subcommand: string, args: readonly string[], signal: AbortSignal | undefined): Promise<string> {
    const timeout = AbortSignal.timeout(this.spec.timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    try {
      return (await this.run(this.spec.command, [...this.spec.commandArgs, subcommand, ...args], combined)).stdout
    } catch (error) {
      // The caller's cancellation is not a graphify failure: rethrow its reason.
      if (signal?.aborted === true) throw signal.reason
      if (timeout.aborted) throw new GraphifyCliError(`graphify ${subcommand} timed out after ${String(this.spec.timeoutMs)} ms`)
      throw new GraphifyCliError(`graphify ${subcommand} failed: ${failureDetail(error)}`)
    }
  }
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
export function parseQueryResult(stdout: string): readonly GraphifyElement[] {
  const elements: GraphifyElement[] = []
  for (const line of stdout.split('\n')) {
    const element = readElement(line)
    if (element !== undefined) elements.push(element)
  }
  return elements
}

/**
 * Read one render line as a graph element.
 * @param line - one line of a `graphify query` render.
 * @returns the element the line renders, or `undefined` for a header, notice, or marker.
 */
function readElement(line: string): GraphifyElement | undefined {
  if (line.startsWith(NODE_PREFIX)) return readNode(line)
  if (line.startsWith(EDGE_PREFIX)) return readEdge(line)
  return undefined
}

/**
 * Read one `NODE <label> [src=… loc=… community=…]` line.
 * @param line - the node line graphify rendered.
 * @returns the node's element, or `undefined` when the line carries no attribute bracket.
 */
function readNode(line: string): GraphifyElement | undefined {
  const body = line.slice(NODE_PREFIX.length)
  const bracket = body.indexOf(' [src=')
  if (bracket < 0) return undefined
  return { line, entities: [body.slice(0, bracket)] }
}

/**
 * Read one `EDGE <from> --<relation> [<confidence>]--> <to>[ at=…]` line.
 * @param line - the edge line graphify rendered.
 * @returns the edge's element, or `undefined` when the line is missing a relation or a target.
 */
function readEdge(line: string): GraphifyElement | undefined {
  const body = line.slice(EDGE_PREFIX.length)
  const relation = body.indexOf(EDGE_RELATION_MARKER)
  const terminator = body.indexOf(EDGE_TERMINATOR)
  if (relation < 0 || terminator < relation) return undefined
  const target = body.slice(terminator + EDGE_TERMINATOR.length)
  const site = target.indexOf(EDGE_SITE_MARKER)
  return {
    line,
    entities: [body.slice(0, relation), site < 0 ? target : target.slice(0, site)],
  }
}

/**
 * Read one frontmatter field of a memory document.
 * @param field - the anchored field pattern to apply.
 * @param document - the whole document text.
 * @returns the field's unescaped value, or `undefined` when the document omits it.
 */
function readField(field: RegExp, document: string): string | undefined {
  const escaped = field.exec(document)?.[1]
  return escaped === undefined ? undefined : unescapeYamlQuoted(escaped)
}

/**
 * Reverse a YAML double-quoted scalar exactly as graphify's writer escapes it.
 * @param value - escaped scalar text between the quotes.
 * @returns the text the scalar denotes.
 */
function unescapeYamlQuoted(value: string): string {
  return value.replace(/\\(x[\dA-Fa-f]{2}|u[\dA-Fa-f]{4}|.)/gu, (_escape: string, code: string) => {
    if (code.startsWith('x') || code.startsWith('u')) return String.fromCodePoint(Number.parseInt(code.slice(1), 16))
    return ESCAPES[code] ?? code
  })
}

/**
 * List one directory, treating a missing directory as empty.
 * @param path - directory to list.
 * @returns the directory's entry names.
 */
async function readDirectory(path: string): Promise<readonly string[]> {
  try {
    return await readdir(path)
  } catch (error) {
    // A graph that has never retained anything has no memory directory; any
    // other failure (permissions, a file where the directory belongs) is real.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/**
 * Describe a failed invocation, preferring graphify's own stderr over the runner's message.
 * @param error - the rejection the command runner produced.
 * @returns graphify's diagnostic when it wrote one, otherwise the error message.
 */
function failureDetail(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string') {
    const stderr = error.stderr.trim()
    if (stderr !== '') return stderr
  }
  return error instanceof Error ? error.message : String(error)
}
