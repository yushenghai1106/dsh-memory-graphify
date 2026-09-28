# @deepseek-ai/dsh-memory-graphify

English | [中文](README.zh.md)

## Summary

This repository carries one installable [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin as a standalone package: `@deepseek-ai/dsh-memory-graphify`, an installable `dsh --profile` bundle that gives the agent long-term memory served by a [graphify](https://pypi.org/project/graphifyy/) knowledge graph. Recall traverses that graph for the current question, and retention saves memory documents that graphify's own extractor folds back into it. The layer targets the rows [dsh-base](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/bundle/base) ships, so it needs a base-backed profile, and graphify — not this package — owns the graph, its extraction, and its document format. `lib/` holds the built artifacts and is committed, so a clone installs and runs without a build step.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Install into a profile

```text
dsh plugin --profile <name> add <this repository>
dsh plugin --profile <name> remove @deepseek-ai/dsh-memory-graphify
```

`add` installs the package into the profile directory with pnpm and reconciles `dsh.profile.bundles`, so this package's `dsh.bundle.patch` layer joins the stack after `dsh-base` and the mode bundle. `<this repository>` accepts a git URL, a local path, or the published package name once released. The layer enables the disabled `memory-graphify` row dsh-base ships and repoints [dsh-tool-memory](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/memory/tool-memory) at the `graphify` provider, restating tool-memory's tuned defaults; your profile's `cordis.patch.yml` and `--patch` overlays still win. Over a tree without those rows the layer warns and changes nothing.

### What you get

- **The `graphify` memory provider** (registered on `ctx.memoryProviders`) — recall and retention as described below.
- **`dsh-tool-memory` selection** — the `memory` tool, the session-start `MEMORY`/`USER` snapshots, inbox prefetch, and automatic completed-turn retention now read and write through the graph.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `graphPath` | `$GRAPHIFY_GRAPH_PATH` | Absolute path of the `graph.json` this deployment queries; the graph's directory owns the `memory/` documents and `reflections/LESSONS.md`. |
| `command` | `graphify` | Executable that runs graphify; set an interpreter such as `python` when graphify is not on `PATH`. |
| `commandArgs` | `[]` | Arguments placed before the subcommand, e.g. `['-m', 'graphify']` with an interpreter. |
| `traversal` | `bfs` | Traversal graphify uses to select a query result; `dfs` selects graphify's `--dfs` flag. |
| `tokenBudget` | `2000` | Approximate token budget graphify spends on one query result. |
| `timeoutMs` | `60000` | Bound on one graphify invocation, in milliseconds. |
| `prefetchCacheEntries` | `8` | Number of prefetched query results the provider holds before dropping the oldest. |

`graphPath` is required and must be absolute, so no invocation depends on the harness process's working directory; the bundle reads it from the environment, and an unset variable fails the plugin at load with the variable named. Nothing verifies the graph exists at load: a deployment that builds the graph later is as valid as one that built it first, and graphify names the missing path in its own failure. Set any field on the `memory-graphify` row through your profile's `cordis.patch.yml` or a `--patch` overlay.

```text
GRAPHIFY_GRAPH_PATH=/work/my-repo/graphify-out/graph.json
dsh --profile my-agent "why does the deploy fail?"
```

### Recall and retention

| Memory method | graphify invocation | Effect |
|---|---|---|
| `prefetch(query)` | `reflect --if-stale`, then `query` | Refreshes the lessons overlay and answers the query the matching recall will ask |
| `recall(query, limit, signal)` | `query "<question>" --budget <n> --graph <path>` | Returns up to `limit` graph elements, edges before nodes |
| `retain(input)` | `save-result --question <user> --answer <assistant> --type turn` | Saves a completed exchange as a memory document |
| `retainTool(target, content)` | `save-result --question <content> --answer <content> --type <target>` | Saves a curated entry as a document of its target's type |
| `forgetTool(target, content)` | none | Deletes every memory document whose recorded question and type match |

Recalled facts carry graphify's own render line, so a recalled edge reads as `EDGE AuthService --calls [EXTRACTED]--> TokenStore at=src/auth.ts:L14`. Every element the traversal selected is equally relevant, so each recalled fact scores 1 and graphify's traversal is the ranking; the consumer's `limit` cuts from the tail, and edges come first because a recalled line is only useful when it carries the relation the question asked about. A question that matches no seed node recalls nothing rather than a placeholder.

Retention is graphify's own feedback loop: a saved document is extracted into the graph on the next `graphify update`, which only a graphify run outside this plugin starts. `retainTool` writes the entry as both question and answer because graphify stores every memory document as a question and its answer, and the document type carries the curated target.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle substance is a two-row patch document: `memory-graphify` enabled with its configuration, and `tool-memory` restated with `provider: graphify`. The package behind the row is a Cordis plugin: `resolveSpec` validates configuration into the facts one provider instance is bound to, and `apply` registers the provider through one effect, so unloading the tree unregisters it.

### Patch semantics

A patch replaces the targeted row's whole `config` rather than merging into it, which is why the layer restates tool-memory's tuned values. The layer must sit after `dsh-base` in `dsh.profile.bundles`; the reconcile step appends installed bundles, so the order holds by construction.

### Build from source

`lib/` is committed, so a clone needs no build. Rebuild after editing `src/` with `npm run build`, which compiles `src/` to `lib/` through `tsc` (`tsconfig.build.json`). The build needs the harness seam packages resolvable — `@deepseek-ai/dsh-memory` and `@deepseek-ai/dsh-invariants` are peer dependencies a DeepSeek Harness installation provides and are not yet on npm — so build inside a harness checkout, or link one. `npm run typecheck` and `npm run test` have the same requirement; the tests boot a real Loader tree over a keyless graphify stand-in command, so they need no graphify install and no API key.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The bundle substance: enable the shipped row and select the provider |
| [`src/index.ts`](src/index.ts) | Plugin: config schema, `resolveSpec`, provider registration |
| [`src/client.ts`](src/client.ts) | Command boundary over the graphify command line and query-render parsing |
| [`src/provider.ts`](src/provider.ts) | `MemoryProvider` implementation: recall mapping, prefetch cache, retention |
| [`src/types.ts`](src/types.ts) | Resolved spec and graph-element types |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when you want to go deeper into profiles, the memory seam, or the consumer that renders this provider.

- [packages/memory](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/memory) — the memory group map: the provider registry and the consumer that renders it.
- [dsh-tool-memory](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/memory/tool-memory) — prefetch, current-question recall, session-start snapshots, and automatic retention.
- [Capability seams](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/capability-seams.md) — the Service Definition / Service Provider / Consumer split this package follows.

-----

<a id="model-experience"></a>
## Model Experience

### Recalled graph elements

#### What the model sees

Each recalled fact is one graphify render line, so the model reads graph structure as text: `EDGE AuthService --calls [EXTRACTED]--> TokenStore at=src/auth.ts:L14`. The lines are reference context rather than instructions, and `dsh-tool-memory` injects only them; this package contributes no prompt text and no tool definition of its own.

#### Token effect

One element is one short line, and the consumer's `recallLimit` and `recallMaxChars` bound how many lines one request carries, so the cost grows with the question's graph neighbourhood rather than with the graph's size.

#### KV Cache effect

Recalled elements are appended to the request that asks the question, so they differ per question and form no stable prefix. The provider contributes no prompt section and no tool definition, so it adds no fixed prefix bytes, and a deployment that stops recalling changes only the request tail.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No graph build** — the provider reads a graph that exists. An unbuilt or stale graph recalls what it holds; nothing here extracts, updates, or clusters.
- **One graph per mount** — a provider instance is bound to one `graphPath`. A session that works across several projects recalls from this graph only, and a multi-project deployment mounts one row per graph.
- **Deletion leaves the graph data** — `forgetTool` deletes memory documents, and the extraction of a deleted document stays in the graph until a graphify update removes it.
- **Traversal, not vector search** — recall returns what graphify's traversal reaches from the seeds the question matches. A fact outside that subgraph cannot be recalled, however relevant it is.
- **No outcome recording** — the memory seam exposes no way to report whether a recall was useful, so the work-memory outcomes graphify's lessons overlay aggregates are not written by this provider.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The package originates in the DeepSeek Harness monorepo under `packages/memory/memory-graphify`; this repository is its standalone distribution with committed `lib/` artifacts. The install path follows `apps/cli/src/plugin.ts` upstream; `tests/composition.spec.ts` boots the provider through the Loader over a keyless graphify stand-in. Set this repository's URL in `package.json` before publishing.

</details>
