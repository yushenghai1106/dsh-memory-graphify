# @deepseek-ai/dsh-memory-graphify

[English](README.md) | 中文

## 概述

本仓库以独立包的形式承载一个可安装的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：`@deepseek-ai/dsh-memory-graphify`，一个可安装的 `dsh --profile` bundle，让 agent 的长期记忆由 [graphify](https://pypi.org/project/graphifyy/) 知识图谱提供。召回针对当前问题遍历该图，保留则保存记忆文档，由 graphify 自己的抽取流程折回图中。本层目标是 [dsh-base](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/bundle/base) 已发布的那些行，因此需要基于 base 的 profile；图谱、抽取与文档格式由 graphify 而非本包拥有。`lib/` 保存构建产物并随仓库提交，因此克隆后无需构建即可安装运行。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 安装到 profile

```text
dsh plugin --profile <name> add <this repository>
dsh plugin --profile <name> remove @deepseek-ai/dsh-memory-graphify
```

`add` 会用 pnpm 把本包安装进 profile 目录并调和 `dsh.profile.bundles`，因此本包的 `dsh.bundle.patch` 层会排在 `dsh-base` 与模式 bundle 之后。`<this repository>` 可以是 git URL、本地路径，或正式发布后的包名。该层启用 dsh-base 中默认关闭的 `memory-graphify` 行，并把 [dsh-tool-memory](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/memory/tool-memory) 指向 `graphify` provider，同时复述 tool-memory 的调优默认值；你 profile 的 `cordis.patch.yml` 与 `--patch` overlay 仍然优先。在没有这些行的树上，本层只告警、不做任何更改。

### 你会得到什么

- **`graphify` 记忆 provider**（注册到 `ctx.memoryProviders`）——即下文描述的召回与保留。
- **`dsh-tool-memory` 选中它**——`memory` 工具、会话开始的 `MEMORY`/`USER` 快照、收件箱预取以及已完成轮次的自动保留，都改为读写这张图。

### 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `graphPath` | `$GRAPHIFY_GRAPH_PATH` | 本部署查询的 `graph.json` 绝对路径；图所在目录拥有 `memory/` 文档与 `reflections/LESSONS.md`。 |
| `command` | `graphify` | 运行 graphify 的可执行文件；graphify 不在 `PATH` 上时设置为 `python` 之类的解释器。 |
| `commandArgs` | `[]` | 置于子命令之前的参数，例如配合解释器使用 `['-m', 'graphify']`。 |
| `traversal` | `bfs` | graphify 选择查询结果的遍历方式；`dfs` 选择 graphify 的 `--dfs` 标志。 |
| `tokenBudget` | `2000` | graphify 在单次查询结果上花费的近似 token 预算。 |
| `timeoutMs` | `60000` | 单次 graphify 调用的时限，单位毫秒。 |
| `prefetchCacheEntries` | `8` | Provider 在淘汰最旧结果之前持有的预取查询结果数量。 |

`graphPath` 必填且必须为绝对路径，因此任何调用都不依赖 harness 进程的工作目录；bundle 从环境读取它，未设置时插件在加载期失败并点名该变量。加载时不会校验图是否存在：稍后才建图的部署与先建图的部署同样合法，缺少的路径会由 graphify 自己在失败信息中点名。任何字段都可以通过你 profile 的 `cordis.patch.yml` 或 `--patch` overlay 设置在 `memory-graphify` 行上。

```text
GRAPHIFY_GRAPH_PATH=/work/my-repo/graphify-out/graph.json
dsh --profile my-agent "why does the deploy fail?"
```

### 召回与保留

| 记忆方法 | graphify 调用 | 效果 |
|---|---|---|
| `prefetch(query)` | 先 `reflect --if-stale`，再 `query` | 刷新 lessons 叠加层，并预先回答后续匹配召回会提出的查询 |
| `recall(query, limit, signal)` | `query "<question>" --budget <n> --graph <path>` | 最多返回 `limit` 个图元素，边在节点之前 |
| `retain(input)` | `save-result --question <user> --answer <assistant> --type turn` | 把已完成的交换存为记忆文档 |
| `retainTool(target, content)` | `save-result --question <content> --answer <content> --type <target>` | 把精编条目存为其目标类型的文档 |
| `forgetTool(target, content)` | 无 | 删除所有记录的 question 与 type 都匹配的记忆文档 |

召回事实携带 graphify 自己的渲染行，因此一条被召回的边读作 `EDGE AuthService --calls [EXTRACTED]--> TokenStore at=src/auth.ts:L14`。遍历选中的每个元素都同等相关，所以每条召回事实得分均为 1，排序由 graphify 的遍历决定；调用方的 `limit` 从末尾截断，边排在前面，因为一条召回行只有在携带问题所问的关系时才有用。问题没有匹配到任何种子节点时召回为空，而不是给出占位内容。

留存走的是 graphify 自己的反馈回路：保存的文档会在下一次 `graphify update` 时被抽取进图，而那次更新只能由本插件之外的 graphify 运行发起。`retainTool` 把条目的文本同时写为 question 与 answer，因为 graphify 把每条记忆都存为一问一答，而文档类型承载精编目标。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

bundle 的实体是一份两行的 patch 文档：启用带配置的 `memory-graphify`，以及复述为 `provider: graphify` 的 `tool-memory`。行背后的包是一个 Cordis 插件：`resolveSpec` 把配置校验为一个 provider 实例绑定的事实，`apply` 通过一个 effect 注册 provider，因此卸载树即注销它。

### Patch 语义

patch 会整体替换目标行的 `config` 而不是合并，因此本层复述了 tool-memory 的调优值。本层必须排在 `dsh.profile.bundles` 中 `dsh-base` 之后；调和步骤会把已安装的 bundle 追加进去，因此顺序天然成立。

### 从源码构建

`lib/` 随仓库提交，克隆后无需构建。修改 `src/` 后用 `npm run build` 重建，它通过 `tsc`（`tsconfig.build.json`）把 `src/` 编译到 `lib/`。构建需要可解析的 harness seam 包——`@deepseek-ai/dsh-memory` 与 `@deepseek-ai/dsh-invariants` 是由 DeepSeek Harness 安装提供的 peer 依赖，尚未发布到 npm——因此请在 harness 检出内构建，或链接一个。`npm run typecheck` 与 `npm run test` 有相同要求；测试通过无密钥的 graphify 替身命令启动真实 Loader 树，因此无需安装 graphify，也无需 API key。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | bundle 实体：启用已发布的行并选择 provider |
| [`src/index.ts`](src/index.ts) | 插件：配置 schema、`resolveSpec`、provider 注册 |
| [`src/client.ts`](src/client.ts) | graphify 命令行的命令边界与查询渲染解析 |
| [`src/provider.ts`](src/provider.ts) | `MemoryProvider` 实现：召回映射、预取缓存、保留 |
| [`src/types.ts`](src/types.ts) | 已解析 spec 与图元素类型 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

想深入了解 profile、记忆 seam 或渲染本 provider 的消费方时，阅读这些页面。

- [packages/memory](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/memory) —— memory 组地图：provider 注册表与渲染它的消费方。
- [dsh-tool-memory](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/memory/tool-memory) —— 预取、针对当前问题的召回、会话开始快照与自动保留。
- [Capability seams](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/capability-seams.zh.md) —— 本包遵循的 Service Definition / Service Provider / Consumer 拆分。

-----

<a id="model-experience"></a>
## 模型体验

### 被召回的图元素

#### 模型看到什么

每条召回事实都是一行 graphify 渲染行，模型因此以文本形式读到图结构：`EDGE AuthService --calls [EXTRACTED]--> TokenStore at=src/auth.ts:L14`。这些行是参考上下文而非指令，`dsh-tool-memory` 只注入它们；本包本身不贡献任何提示文本，也不贡献任何工具定义。

#### Token 影响

一个元素就是一行短文本，消费方的 `recallLimit` 与 `recallMaxChars` 限制单次请求携带的行数，因此成本随问题的图邻域增长，而不是随图的规模增长。

#### KV Cache 影响

被召回的元素会追加到提出该问题的请求上，因此它们随问题变化，不构成稳定前缀。本 Provider 不贡献提示段落也不贡献工具定义，因此也不增加固定前缀字节；关闭召回的部署只改变请求尾部。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **不建图** —— 本 Provider 只读已存在的图。未建或陈旧的图只能召回它所持有的内容；本包不做抽取、更新或聚类。
- **一次挂载一个图** —— 一个 Provider 实例绑定一个 `graphPath`。跨多个项目工作的会话只从这一个图召回，多项目部署需要为每个图挂载一行。
- **删除会留下图数据** —— `forgetTool` 删除记忆文档，被删除文档的抽取结果仍留在图中，直到某次 graphify 更新将其移除。
- **遍历而非向量检索** —— 召回返回 graphify 从问题所匹配的种子出发能到达的内容。落在该子图之外的事实无论多相关都无法被召回。
- **不记录结果信号** —— 记忆 seam 没有上报某次召回是否有用的途径，因此 graphify 的 lessons 叠加层所聚合的 work-memory 结果信号不由本 Provider 写入。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的上下文——点击展开</summary>

本包源自 DeepSeek Harness monorepo 的 `packages/memory/memory-graphify`；本仓库是其携带 `lib/` 产物的独立发行版。安装路径遵循上游的 `apps/cli/src/plugin.ts`；`tests/composition.spec.ts` 通过 Loader 在无密钥的 graphify 替身上启动本 provider。发布前请在 `package.json` 中填入本仓库的 URL。

</details>
