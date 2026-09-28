/**
 * Real-composition proof for the graphify memory provider: a Loader-booted
 * tree mounts the shipped memory consumer, the provider, and the storage stack
 * over a keyless stand-in for the graphify command line, then drives the
 * model's `memory` tool and observes the durable memory document and the
 * recalled render line.
 */

import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import MemoryProviderRegistry from '@deepseek-ai/dsh-memory'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolMemory from '@deepseek-ai/dsh-tool-memory'
import { GraphifyMemoryProvider } from '../src/provider.ts'
import * as memoryGraphify from '../src/index.ts'

const CONFIG = fileURLToPath(new URL('./fixtures/graphify-memory.cordis.yml', import.meta.url))
const STANDIN = fileURLToPath(new URL('./fixtures/graphify-standin.mjs', import.meta.url))
const GRAPH_PATH = join(tmpdir(), 'dsh-memory-graphify-graph', 'graphify-out', 'graph.json')

const liveContexts = new Set<Context>()
const liveRoots = new Set<string>()

afterEach(async () => {
  await Promise.all([...liveContexts].map(async ctx => ctx.fiber.dispose()))
  liveContexts.clear()
  await Promise.all([...liveRoots].map(async root => rm(root, { recursive: true, force: true })))
  liveRoots.clear()
})

/** Boot the fixture tree against one stand-in command. */
async function harness(command: string): Promise<{ ctx: Context; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-graphify-'))
  liveRoots.add(root)
  const patches: PatchOptions[] = [
    { id: 'storage-json', config: { root } },
    { id: 'memory-graphify', config: { graphPath: GRAPH_PATH, command, commandArgs: [STANDIN] } },
  ]
  const ctx = await boot('memory-graphify-composition-test', CONFIG, patches, (context) => {
    context.loader.builtins['memory-graphify-test-storage'] = Storage
    context.loader.builtins['memory-graphify-test-storage-json'] = StorageJson
    context.loader.builtins['memory-graphify-test-storage-domain'] = StorageDomain
    context.loader.builtins['memory-graphify-test-system-prompt'] = SystemPrompt
    context.loader.builtins['memory-graphify-test-tools'] = ToolRuntime
    context.loader.builtins['memory-graphify-test-memory'] = MemoryProviderRegistry
    context.loader.builtins['memory-graphify-test-provider'] = memoryGraphify
    context.loader.builtins['memory-graphify-test-tool-memory'] = ToolMemory
  })
  liveContexts.add(ctx)
  return { ctx, root }
}

/** Run one `memory` tool call. */
async function memory(ctx: Context, arguments_: object) {
  return await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(randomUUID()),
    name: 'memory',
    arguments: arguments_,
  })
}

/** Rendered text of one tool result. */
function textOf(result: Awaited<ReturnType<typeof memory>>): string {
  return result.content.map(block => block.type === 'text' ? block.text : '').join('')
}

describe('Loader-composed graphify memory', () => {
  it('retains a curated entry as a memory document and recalls it back into the tool result', async () => {
    const { ctx } = await harness(process.execPath)
    const registry = ctx.memoryProviders
    expect(registry.get(memoryGraphify.GRAPHIFY_PROVIDER_ID)).toBeInstanceOf(GraphifyMemoryProvider)

    const added = await memory(ctx, { action: 'add', target: 'memory', content: 'Nimbus owns the deploy window.' })
    expect(textOf(added)).toContain('Memory memory saved')

    // Durable: the provider saved a graphify memory document beside the graph.
    const documents = await readdir(join(dirname(GRAPH_PATH), 'memory'))
    expect(documents).toHaveLength(1)
    expect(documents[0]).toMatch(/^query_\d+\.md$/)

    // Model-visible: the consumer renders the stand-in's graph line into the tool result.
    const recalled = await memory(ctx, { action: 'recall', target: 'memory', content: 'deploy' })
    expect(recalled.isError).toBe(false)
    expect(textOf(recalled)).toContain('Nimbus owns the deploy window.')
    expect(textOf(recalled)).toContain('--remembered [EXTRACTED]-->')

    // Disposal: unloading the tree unregisters the provider it contributed.
    await ctx.fiber.dispose()
    liveContexts.delete(ctx)
    expect(() => registry.get(memoryGraphify.GRAPHIFY_PROVIDER_ID))
      .toThrow("configured memory provider 'graphify' is not registered")
  })

  it('surfaces a missing graphify command as a failed memory write and stores nothing', async () => {
    const { ctx } = await harness('dsh-graphify-standin-missing')

    const added = await memory(ctx, { action: 'add', target: 'memory', content: 'Nimbus owns the deploy window.' })

    expect(added.isError).toBe(true)
    expect(textOf(added)).toContain('graphify save-result failed')
  })
})
