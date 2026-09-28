import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import MemoryProviderRegistry from '@deepseek-ai/dsh-memory'
import * as memoryGraphify from '../src/index.ts'
import { GraphifyCli, GraphifyCliError, parseQueryResult } from '../src/client.ts'
import { GraphifyMemoryProvider } from '../src/provider.ts'
import type { GraphifySpec } from '../src/types.ts'

const GRAPH_PATH = '/project/graphify-out/graph.json'
const GRAPH_DIRECTORY = dirname(GRAPH_PATH)

/** The spec `resolveSpec` produces from `graphPath` alone: every documented default. */
const SPEC: GraphifySpec = {
  command: 'graphify',
  commandArgs: [],
  graphPath: GRAPH_PATH,
  traversal: 'bfs',
  tokenBudget: 2_000,
  timeoutMs: 60_000,
  memoryDir: join(GRAPH_DIRECTORY, 'memory'),
  lessonsPath: join(GRAPH_DIRECTORY, 'reflections', 'LESSONS.md'),
  prefetchCacheEntries: 8,
}

const QUERY = 'what connects auth to the database?'

/** One recorded invocation of the injected command boundary. */
interface Invocation {
  readonly command: string
  readonly args: readonly string[]
  readonly signal: AbortSignal
}

/** A command boundary that answers every invocation from one handler. */
function serve(respond: (invocation: Invocation) => string): { run: NativeCommandRunner; calls: Invocation[] } {
  const calls: Invocation[] = []
  const run: NativeCommandRunner = (command, args, signal) => {
    const invocation = { command, args: [...args], signal }
    calls.push(invocation)
    // Deferred so a throwing handler rejects the call instead of throwing here.
    return Promise.resolve().then(() => respond(invocation)).then(stdout => ({ stdout, stderr: '' }))
  }
  return { run, calls }
}

/** A command boundary that settles only when its signal aborts, as `execFile` does. */
const abortableRun: NativeCommandRunner = (_command, _args, signal) =>
  new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { reject(signal.reason as Error) }, { once: true })
  })

function cliWith(run: NativeCommandRunner, overrides: Partial<GraphifySpec> = {}): GraphifyCli {
  return new GraphifyCli({ ...SPEC, ...overrides }, run)
}

const RENDER = [
  "Graph: graphify-out/graph.json (12 nodes) | Traversal: BFS depth=2 | Start: ['AuthService'] | 3 nodes found",
  '',
  'NODE AuthService [src=src/auth.ts loc=L9 community=core]',
  'NODE TokenStore [src=src/token.ts loc=L4 community=core]',
  'EDGE AuthService --calls [EXTRACTED]--> TokenStore at=src/auth.ts:L14',
].join('\n')

function memoryDocument(type: string, question: string, answer: string): string {
  const escaped = question.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')
  return [
    '---',
    `type: "${type}"`,
    'date: "2026-09-28T10:00:00+00:00"',
    `question: "${escaped}"`,
    'contributor: "graphify"',
    '---',
    '',
    `# Q: ${question}`,
    '',
    '## Answer',
    '',
    answer,
  ].join('\n')
}

describe('parseQueryResult', () => {
  it('reads nodes and edges in render order and names each element', () => {
    expect(parseQueryResult(RENDER)).toEqual([
      { line: 'NODE AuthService [src=src/auth.ts loc=L9 community=core]', entities: ['AuthService'] },
      { line: 'NODE TokenStore [src=src/token.ts loc=L4 community=core]', entities: ['TokenStore'] },
      { line: 'EDGE AuthService --calls [EXTRACTED]--> TokenStore at=src/auth.ts:L14', entities: ['AuthService', 'TokenStore'] },
    ])
  })

  it('drops the truncation notices and the trailing marker that name no element', () => {
    const truncated = [
      '[!] TRUNCATED: showing 1 of 2 nodes (~2-token budget). The answer may be among the 1 cut nodes.',
      '',
      'NODE AuthService [src=src/auth.ts loc=L9 community=core]',
      '... (truncated — 1 more nodes cut by ~2000-token budget. Narrow with context_filter=[\'call\'])',
    ].join('\n')

    expect(parseQueryResult(truncated).map(element => element.entities)).toEqual([['AuthService']])
  })

  it('drops the over-budget notice that precedes a complete answer', () => {
    const overBudget = `[i] Complete answer over budget: all 3 nodes and 1 edges shown (~700 tokens).\n\n${RENDER.split('\n').slice(2).join('\n')}`

    expect(parseQueryResult(overBudget)).toHaveLength(3)
  })

  it.each([
    ['a question that matched no seed node', 'No matching nodes found.'],
    ['empty output', ''],
  ])('returns nothing for %s', (_case, stdout) => {
    expect(parseQueryResult(stdout)).toEqual([])
  })

  it('keeps a label that contains spaces and strips an edge target at its relation site', () => {
    const render = [
      'NODE Some Service [src=src/svc.ts loc=L1 community=core]',
      'EDGE Some Service --calls [INFERRED]--> Other Service at=src/svc.ts:L3',
    ].join('\n')

    expect(parseQueryResult(render).map(element => element.entities)).toEqual([
      ['Some Service'],
      ['Some Service', 'Other Service'],
    ])
  })

  it('ignores a node line that carries no attribute bracket', () => {
    expect(parseQueryResult('NODE Broken')).toEqual([])
  })

  it.each([
    ['no relation marker', 'EDGE AuthService TokenStore'],
    ['no target marker', 'EDGE AuthService --calls TokenStore'],
  ])('ignores an edge line with %s', (_case, line) => {
    expect(parseQueryResult(line)).toEqual([])
  })

  it('keeps an edge that names no relation site', () => {
    expect(parseQueryResult('EDGE AuthService --calls [EXTRACTED]--> TokenStore').map(element => element.entities))
      .toEqual([['AuthService', 'TokenStore']])
  })
})

describe('GraphifyCli invocations', () => {
  it('asks graphify for a bounded breadth-first subgraph of the configured graph', async () => {
    const { run, calls } = serve(() => RENDER)
    const elements = await cliWith(run).query(QUERY, new AbortController().signal)

    expect(calls[0]?.command).toBe('graphify')
    expect(calls[0]?.args).toEqual(['query', QUERY, '--budget', '2000', '--graph', SPEC.graphPath])
    expect(elements).toHaveLength(3)
  })

  it('selects depth-first traversal only when configured', async () => {
    const { run, calls } = serve(() => RENDER)
    await cliWith(run, { traversal: 'dfs' }).query(QUERY)

    expect(calls[0]?.args).toEqual(['query', QUERY, '--dfs', '--budget', '2000', '--graph', SPEC.graphPath])
  })

  it('runs an interpreter with the graphify module as its argument prefix', async () => {
    const { run, calls } = serve(() => 'No matching nodes found.')
    await cliWith(run, { command: 'python', commandArgs: ['-m', 'graphify'] }).query(QUERY)

    expect(calls[0]?.command).toBe('python')
    expect(calls[0]?.args.slice(0, 3)).toEqual(['-m', 'graphify', 'query'])
  })

  it('saves a memory document into the configured memory directory', async () => {
    const { run, calls } = serve(() => 'Saved to /project/graphify-out/memory/query_1.md')
    await cliWith(run).save({ question: 'q', answer: 'a', type: 'memory' })

    expect(calls[0]?.args).toEqual([
      'save-result',
      '--question', 'q',
      '--answer', 'a',
      '--type', 'memory',
      '--memory-dir', SPEC.memoryDir,
    ])
  })

  it('refreshes the lessons overlay only while it is stale', async () => {
    const { run, calls } = serve(() => 'Lessons already up to date -> /project/graphify-out/reflections/LESSONS.md')
    await cliWith(run).refreshLessons()

    expect(calls[0]?.args).toEqual([
      'reflect',
      '--if-stale',
      '--memory-dir', SPEC.memoryDir,
      '--out', SPEC.lessonsPath,
      '--graph', SPEC.graphPath,
    ])
  })
})

describe('GraphifyCli failures', () => {
  function failing(error: unknown): NativeCommandRunner {
    // Thrown rather than rejected: `failureDetail` reports any thrown value, Error or not.
    return () => Promise.resolve().then(() => { throw error })
  }

  it("reports graphify's own stderr over the runner message", async () => {
    const error = Object.assign(new Error('Command failed: graphify query'), { stderr: 'error: graph file not found: /missing/graph.json\n' })

    await expect(cliWith(failing(error)).query(QUERY)).rejects.toThrow('graphify query failed: error: graph file not found: /missing/graph.json')
  })

  it('reports the runner message when graphify wrote no stderr', async () => {
    await expect(cliWith(failing(new Error('spawn graphify ENOENT'))).query(QUERY))
      .rejects.toThrow('graphify query failed: spawn graphify ENOENT')
  })

  it('reports the runner message when graphify wrote only blank stderr', async () => {
    const error = Object.assign(new Error('spawn graphify ENOENT'), { stderr: '  \n' })

    await expect(cliWith(failing(error)).query(QUERY)).rejects.toThrow('graphify query failed: spawn graphify ENOENT')
  })

  it('reports a rejected non-Error value', async () => {
    await expect(cliWith(failing('killed')).query(QUERY)).rejects.toThrow('graphify query failed: killed')
  })

  it('reports a non-string stderr through the runner message', async () => {
    const error = Object.assign(new Error('boom'), { stderr: 42 })

    await expect(cliWith(failing(error)).query(QUERY)).rejects.toThrow('graphify query failed: boom')
  })

  it('rethrows the caller cancellation reason rather than a graphify failure', async () => {
    const controller = new AbortController()
    const pending = cliWith(abortableRun).query(QUERY, controller.signal)
    controller.abort(new Error('turn cancelled'))

    await expect(pending).rejects.toThrow('turn cancelled')
  })

  it('reports an over-bounded invocation as a timeout', async () => {
    await expect(cliWith(abortableRun, { timeoutMs: 1 }).query(QUERY))
      .rejects.toThrow('graphify query timed out after 1 ms')
  })

  it('names the failing subcommand of a cancelled save', async () => {
    const controller = new AbortController()
    const pending = cliWith(abortableRun).save({ question: 'q', answer: 'a', type: 'turn' }, controller.signal)
    controller.abort(new Error('stopped'))

    await expect(pending).rejects.toThrow('stopped')
  })

  it('propagates a memory-directory failure that is not a missing directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graphify-'))
    const file = join(directory, 'not-a-directory')
    await writeFile(file, 'x')
    try {
      await expect(cliWith(serve(() => '').run, { memoryDir: file }).forget('q', 'memory')).rejects.toThrow()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('GraphifyCli memory removal', () => {
  let temporary: string | undefined

  async function memoryDirectory(): Promise<string> {
    temporary = await mkdtemp(join(tmpdir(), 'graphify-'))
    return temporary
  }

  afterEach(async () => {
    if (temporary !== undefined) await rm(temporary, { recursive: true, force: true })
    temporary = undefined
  })

  it('deletes only the documents saved for the forgotten entry', async () => {
    const directory = await memoryDirectory()
    await writeFile(join(directory, 'keep-question.md'), memoryDocument('memory', 'Another fact.', 'Another fact.'))
    await writeFile(join(directory, 'keep-type.md'), memoryDocument('user', 'Nimbus owns the deploy.', 'Nimbus owns the deploy.'))
    await writeFile(join(directory, 'forget.md'), memoryDocument('memory', 'Nimbus owns the deploy.', 'Nimbus owns the deploy.'))
    await writeFile(join(directory, 'notes.txt'), memoryDocument('memory', 'Nimbus owns the deploy.', 'Nimbus owns the deploy.'))

    const deleted = await cliWith(serve(() => '').run, { memoryDir: directory }).forget('Nimbus owns the deploy.', 'memory')

    expect(deleted).toBe(1)
    expect((await readdir(directory)).sort()).toEqual(['keep-question.md', 'keep-type.md', 'notes.txt'])
  })

  it('leaves a graph that has never retained anything alone', async () => {
    const deleted = await cliWith(serve(() => '').run, { memoryDir: join(await memoryDirectory(), 'missing') }).forget('q', 'memory')

    expect(deleted).toBe(0)
  })

  it('matches an entry through the escapes graphify writes into the frontmatter', async () => {
    const directory = await memoryDirectory()
    const entry = 'Prefers "short" answers,\nnot one-liners.'
    await writeFile(join(directory, 'entry.md'), memoryDocument('user', entry, entry))

    const deleted = await cliWith(serve(() => '').run, { memoryDir: directory }).forget(entry, 'user')

    expect(deleted).toBe(1)
    expect(await readdir(directory)).toEqual([])
  })

  it('leaves a document alone when a field is missing or carries an unknown escape', async () => {
    const directory = await memoryDirectory()
    await writeFile(join(directory, 'untyped.md'), '---\nquestion: "q"\n---\n\nbody\n')
    await writeFile(join(directory, 'unknown-escape.md'), '---\ntype: "memory"\nquestion: "a\\qb"\n---\n\nbody\n')

    const cli = cliWith(serve(() => '').run, { memoryDir: directory })

    expect(await cli.forget('q', 'memory')).toBe(0)
    expect(await cli.forget('a\\qb', 'memory')).toBe(0)
    expect(await cli.forget('aqb', 'memory')).toBe(1)
    expect((await readdir(directory)).sort()).toEqual(['untyped.md'])
  })

  it('matches an entry graphify wrote with numeric YAML escapes', async () => {
    const directory = await memoryDirectory()
    await writeFile(join(directory, 'entry.md'), '---\ntype: "memory"\nquestion: "A\\x41c\\u00e9"\n---\n\nbody\n')

    const deleted = await cliWith(serve(() => '').run, { memoryDir: directory }).forget('AAc\u00e9', 'memory')

    expect(deleted).toBe(1)
    expect(await readdir(directory)).toEqual([])
  })
})

describe('GraphifyMemoryProvider recall', () => {
  it('answers the question from the graph and scores every returned element equally', async () => {
    const { run, calls } = serve(() => RENDER)
    const recalls = await new GraphifyMemoryProvider(cliWith(run), 4).recall(QUERY, 4, new AbortController().signal)

    expect(calls).toHaveLength(1)
    expect(recalls.map(recall => recall.fact.content)).toEqual([
      'EDGE AuthService --calls [EXTRACTED]--> TokenStore at=src/auth.ts:L14',
      'NODE AuthService [src=src/auth.ts loc=L9 community=core]',
      'NODE TokenStore [src=src/token.ts loc=L4 community=core]',
    ])
    expect(recalls.map(recall => recall.score)).toEqual([1, 1, 1])
    expect(recalls[0]?.fact).toMatchObject({ entities: ['AuthService', 'TokenStore'], source: 'turn' })
    expect(recalls[0]?.fact.id).toMatch(/^graphify:[0-9a-f]{16}$/)
    expect(recalls[0]?.fact.retainedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('identifies one element by its identifier across recalls', async () => {
    const { run } = serve(() => RENDER)
    const provider = new GraphifyMemoryProvider(cliWith(run), 4)

    const first = await provider.recall(QUERY, 1, new AbortController().signal)
    const second = await provider.recall(QUERY, 1, new AbortController().signal)

    expect(first[0]?.fact.id).toBe(second[0]?.fact.id)
  })

  it('cuts the recalled elements from the tail', async () => {
    const { run } = serve(() => RENDER)
    const recalls = await new GraphifyMemoryProvider(cliWith(run), 4).recall(QUERY, 1, new AbortController().signal)

    expect(recalls).toHaveLength(1)
    expect(recalls[0]?.fact.entities).toEqual(['AuthService', 'TokenStore'])
  })

  it('returns nothing when the question names no element', async () => {
    const { run } = serve(() => 'No matching nodes found.')
    const recalls = await new GraphifyMemoryProvider(cliWith(run), 4).recall(QUERY, 4, new AbortController().signal)

    expect(recalls).toEqual([])
  })

  it('honors caller cancellation before contacting graphify', async () => {
    const { run, calls } = serve(() => RENDER)
    const controller = new AbortController()
    controller.abort(new Error('turn cancelled'))

    await expect(new GraphifyMemoryProvider(cliWith(run), 4).recall(QUERY, 4, controller.signal))
      .rejects.toThrow('turn cancelled')
    expect(calls).toHaveLength(0)
  })
})

describe('GraphifyMemoryProvider prefetch', () => {
  it('refreshes the lessons overlay and answers the matching recall without a second invocation', async () => {
    const { run, calls } = serve(() => RENDER)
    const provider = new GraphifyMemoryProvider(cliWith(run), 4)

    await provider.prefetch(QUERY)
    const recalls = await provider.recall(QUERY, 4, new AbortController().signal)

    expect(calls.map(call => call.args[0])).toEqual(['reflect', 'query'])
    expect(recalls).toHaveLength(3)
  })

  it('runs the query again for a recall the prefetch did not cover', async () => {
    const { run, calls } = serve(() => RENDER)
    const provider = new GraphifyMemoryProvider(cliWith(run), 4)

    await provider.prefetch('a different question')
    await provider.recall(QUERY, 1, new AbortController().signal)

    expect(calls.map(call => call.args[0])).toEqual(['reflect', 'query', 'query'])
  })

  it('drops a prefetch failure and reports it from the recall that repeats the query', async () => {
    const failure = new Error('spawn graphify ENOENT')
    const { run } = serve(() => { throw failure })
    const provider = new GraphifyMemoryProvider(cliWith(run), 4)

    await expect(provider.prefetch(QUERY)).resolves.toBeUndefined()
    await expect(provider.recall(QUERY, 4, new AbortController().signal))
      .rejects.toThrow('graphify query failed: spawn graphify ENOENT')
  })

  it('holds at most the configured number of prefetched results', async () => {
    const { run, calls } = serve(() => RENDER)
    const provider = new GraphifyMemoryProvider(cliWith(run), 1)

    await provider.prefetch('first')
    await provider.prefetch('second')
    await provider.recall('first', 1, new AbortController().signal)
    await provider.recall('second', 1, new AbortController().signal)

    expect(calls.map(call => call.args[0])).toEqual(['reflect', 'query', 'reflect', 'query', 'query'])
  })

  it('keeps a re-prefetched question as the newest result rather than the first', async () => {
    const { run, calls } = serve(() => RENDER)
    const provider = new GraphifyMemoryProvider(cliWith(run), 2)

    await provider.prefetch('first')
    await provider.prefetch('second')
    await provider.prefetch('first')
    await provider.prefetch('third')
    await provider.recall('first', 1, new AbortController().signal)
    await provider.recall('second', 1, new AbortController().signal)
    await provider.recall('third', 1, new AbortController().signal)

    // `second` is the entry evicted above; the two results recalled without a
    // ninth invocation prove the re-prefetched `first` outlived it.
    expect(calls.map(call => call.args[0])).toEqual([
      'reflect', 'query', 'reflect', 'query', 'reflect', 'query', 'reflect', 'query', 'query',
    ])
  })
})

describe('GraphifyMemoryProvider retention', () => {
  it('saves a completed exchange as a retained turn', async () => {
    const { run, calls } = serve(() => 'Saved to /project/graphify-out/memory/query_1.md')
    await new GraphifyMemoryProvider(cliWith(run), 4).retain({ user: 'why?', assistant: 'because.' })

    expect(calls[0]?.args).toContain('turn')
    expect(calls[0]?.args).toContain('why?')
    expect(calls[0]?.args).toContain('because.')
  })

  it.each(['memory', 'user'] as const)('saves a curated %s entry as its own document type', async (target) => {
    const { run, calls } = serve(() => 'Saved to /project/graphify-out/memory/query_1.md')
    await new GraphifyMemoryProvider(cliWith(run), 4).retainTool(target, 'Nimbus owns the deploy.')

    expect(calls[0]?.args).toEqual([
      'save-result',
      '--question', 'Nimbus owns the deploy.',
      '--answer', 'Nimbus owns the deploy.',
      '--type', target,
      '--memory-dir', SPEC.memoryDir,
    ])
  })

  it('deletes a forgotten curated entry from the memory directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graphify-'))
    try {
      await writeFile(join(directory, 'entry.md'), memoryDocument('memory', 'Old fact.', 'Old fact.'))
      const provider = new GraphifyMemoryProvider(cliWith(serve(() => '').run, { memoryDir: directory }), 4)

      await provider.forgetTool('memory', 'Old fact.')

      expect(await readdir(directory)).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('resolveSpec', () => {
  it('fills every documented default and derives the graph-owned layout', () => {
    const spec = memoryGraphify.resolveSpec({ graphPath: SPEC.graphPath })

    expect(spec).toEqual(SPEC)
    expect(spec.memoryDir).toBe(join(dirname(SPEC.graphPath), 'memory'))
    expect(spec.lessonsPath).toBe(join(dirname(SPEC.graphPath), 'reflections', 'LESSONS.md'))
  })

  it('keeps every configured value', () => {
    expect(memoryGraphify.resolveSpec({
      command: 'python',
      commandArgs: ['-m', 'graphify'],
      graphPath: SPEC.graphPath,
      traversal: 'dfs',
      tokenBudget: 500,
      timeoutMs: 1_000,
      prefetchCacheEntries: 1,
    })).toEqual({
      ...SPEC,
      command: 'python',
      commandArgs: ['-m', 'graphify'],
      traversal: 'dfs',
      tokenBudget: 500,
      timeoutMs: 1_000,
      prefetchCacheEntries: 1,
    })
  })

  it.each([
    ['an omitted path', undefined],
    ['a blank path', '   '],
    ['a path that is not absolute', join('graphify-out', 'graph.json')],
    ['a path that names another file', `${dirname(SPEC.graphPath)}/graph.jsonl`],
  ])('rejects %s', (_case, graphPath) => {
    expect(() => memoryGraphify.resolveSpec({ graphPath })).toThrow('memory-graphify: graphPath')
  })

  it('rejects a blank command', () => {
    expect(() => memoryGraphify.resolveSpec({ graphPath: SPEC.graphPath, command: '  ' })).toThrow('memory-graphify: command must not be blank')
  })

  it.each([
    ['tokenBudget', 0],
    ['timeoutMs', 1.5],
    ['prefetchCacheEntries', -1],
  ])('rejects %s %j', (field, value) => {
    expect(() => memoryGraphify.resolveSpec({ graphPath: SPEC.graphPath, [field]: value }))
      .toThrow(`memory-graphify: ${field} '${String(value)}' must be a positive whole number`)
  })
})

describe('memory-graphify plugin', () => {
  it('registers the provider and releases it on disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryProviderRegistry)
    const fiber = await ctx.plugin(memoryGraphify, { graphPath: SPEC.graphPath })

    expect(ctx.memoryProviders.get(memoryGraphify.GRAPHIFY_PROVIDER_ID)).toBeInstanceOf(GraphifyMemoryProvider)

    await fiber.dispose()
    expect(() => ctx.memoryProviders.get(memoryGraphify.GRAPHIFY_PROVIDER_ID))
      .toThrow("configured memory provider 'graphify' is not registered")
    await ctx.fiber.dispose()
  })

  it('refuses to load without a graph to query', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryProviderRegistry)

    await expect(ctx.plugin(memoryGraphify)).rejects.toThrow('memory-graphify: graphPath must name the graphify graph.json to query')
    await ctx.fiber.dispose()
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in memoryGraphify).toBe(false)
    expect(memoryGraphify.name).toBe('memory-graphify')
    expect(memoryGraphify.inject).toEqual(['memoryProviders'])
  })

  it('exposes its command error type', () => {
    expect(new GraphifyCliError('failed').name).toBe('GraphifyCliError')
  })
})
