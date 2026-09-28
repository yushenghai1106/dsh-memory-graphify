// Keyless graphify stand-in for the composition proof: it answers the three
// subcommands the provider invokes, stores memory documents in graphify's
// format under the graph's `memory/` directory, and renders one EDGE line per
// saved document so a recall round-trips the retained text.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const [subcommand = '', ...rest] = process.argv.slice(2)

function flags(args) {
  const out = {}
  for (let index = 0; index < args.length; index++) {
    if (args[index]?.startsWith('--')) out[args[index].slice(2)] = args[index + 1] ?? ''
  }
  return out
}

/** Escape one value the way graphify's YAML writer does. */
function yamlScalar(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')
}

if (subcommand === 'save-result') {
  const argv = flags(rest)
  const question = argv.question ?? ''
  await mkdir(argv['memory-dir'], { recursive: true })
  const document = [
    '---',
    `type: "${yamlScalar(argv.type ?? 'query')}"`,
    `date: "${new Date().toISOString()}"`,
    `question: "${yamlScalar(question)}"`,
    'contributor: "graphify"',
    '---',
    '',
    `# Q: ${question}`,
    '',
    '## Answer',
    '',
    argv.answer ?? '',
  ].join('\n')
  const path = join(argv['memory-dir'], `query_${Date.now()}.md`)
  await writeFile(path, document)
  console.log(`Saved to ${path}`)
} else if (subcommand === 'query') {
  const argv = flags(rest)
  const directory = join(dirname(argv.graph), 'memory')
  const lines = []
  for (const name of (await readdir(directory).catch(() => [])).sort()) {
    if (!name.endsWith('.md')) continue
    const document = await readFile(join(directory, name), 'utf8')
    const question = /^# Q: (.*)$/mu.exec(document)?.[1] ?? ''
    const answer = document.split('## Answer\n')[1]?.trim() ?? ''
    lines.push(`EDGE ${question} --remembered [EXTRACTED]--> ${answer}`)
  }
  const header = `Graph: stand-in | Traversal: BFS depth=2 | Start: ['${questionOf(argv)}'] | ${lines.length} nodes found`
  console.log(lines.length === 0 ? 'No matching nodes found.' : `${header}\n\n${lines.join('\n')}`)
} else if (subcommand === 'reflect') {
  console.log('Lessons already up to date -> stand-in (skipped; omit --if-stale to force)')
} else {
  console.error(`error: unknown subcommand: ${subcommand}`)
  process.exitCode = 1
}

function questionOf(argv) {
  return Object.keys(argv).find(key => !['budget', 'graph', 'dfs'].includes(key)) ?? ''
}
