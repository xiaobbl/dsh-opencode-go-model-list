# 作者的话

纯vibe-coding出来的，解决了DSH的opencode-go模型列表落后实际的问题。  
安装之后更新列表需要删除opencode-go提供商后再重新配置。  
有问题可以提交issue，虽然我不一定会修（误

# dsh-opencode-go-model-list

让 DSH **自带的** `opencode-go` 供应商跟着 opencode Go 套餐的实时模型列表走：新增供应商、不改 `settings.yaml`、不动凭据、不覆盖自带模型。

- 现在：`opencode-go` 路由能列出 27 个模型（pi-ai 随包快照）
- 装上本插件：同一个路由列出 38 个，新增 `deepseek-v4.1-flash`、`kimi-k2.5`、`grok-4.5`、`glm-5`、`qwen3.5-plus`、`mimo-v2-pro/omni`、`minimax-m2.5`、`deepseek-flash`、`hy3-preview`、`union-alpha` 等

## 它解决的是哪个问题

opencode Go 上架新模型（例如 `deepseek-v4.1-flash`）后，DSH 里看不到它。手动加会失败：

```text
llm-pi-ai: provider "opencode-go" model "deepseek-v4.1-flash" needs an api; the installed
catalog does not describe it, so set the route's api to the wire protocol its endpoint speaks
```

原因（见 [discussion #6464](https://github.com/deepseek-ai/deepseek-harness/discussions/6464)）：路由的模型列表来自 pi-ai 随包发布的 **静态 catalog 快照**，而 `dsh-llm-pi-ai` 只提供两条配置路径，两条都不理想：

| 配置手段 | 结果 |
|---|---|
| `providers.opencode-go.models` | **整体替换**该路由的 catalog（27 个自带模型全丢），还要手写 `api`/`baseURL` |
| `modelOverrides` | 只能改 catalog 里**已有**的 id，新增 id 直接拒绝 |
| 新建自定义路由 | 不是自带供应商 `opencode-go`，余额/计费/会话类插件认不出来 |

本插件走第三条路：**在 catalog 层做增量注入**，让新模型变成"自带模型"。

## 原理

1. **目录注入** — 把缺失模型写进 pi-ai 里 `opencode-go` 的 catalog 对象（`MODELS['opencode-go']`）。`dsh-llm-pi-ai` 解析路由时读的就是它（`getBuiltinModels('opencode-go')`），所以设置面板、模型校验、请求解析一律把新模型当作自带模型。
2. **集合补丁** — 包装 pi-ai 模型集合的 `getModels`，让"路由已经解析过"的旧快照也能看到新条目。这样后台刷新到的模型**无需重启**就能出现在模型选择器和请求解析里。
3. **缓存** — 抓取结果落到 `$DSH_HOME/cache/opencode-go-model-list/catalog.json`；下次启动先同步采用缓存再后台刷新，离线也能用。

## 数据来源与推断规则

| 来源 | 用途 |
|---|---|
| `GET https://opencode.ai/zen/go/v1/models` | Go 套餐**实际提供**哪些模型（决定成员，公开可读、无需鉴权；实测 38 个） |
| `GET https://models.dev/api.json` 的 `opencode-go` 切片 | 上下文/输出上限、输入模态、价格、reasoning 选项、`family`（实测 37 条） |
| 自带 catalog 的同族模型 | 补 `api`、`baseUrl`、`compat`（供应商私有线协议）、thinking 等级拼写 |

对每个新模型按"证据强度"逐项推断：

- **协议**：同 `family` 的自带模型 → 供应商自己声明的 SDK（`provider.npm`）→ 同厂商多数协议 → 路由多数协议 → `defaultApi`
- **compat**：先取该协议下**所有**自带模型一致的字段（路由级事实，如 `supportsStore:false`），再叠加同族模型的私有方言（如 deepseek 的 `thinkingFormat: deepseek`）——绝不跨厂商猜
- **thinking 等级**：以 models.dev 声明的 effort 值为准，拼写取同族模型；没有同族模型时显式 pin 未声明等级
- 没有任何元数据的模型（如 `hy3-preview`）：按 id 前缀找最近的兄弟模型克隆，名字由 id 生成

保真度回归（拿自带 27 个模型做"重建"对照，见 `test/fidelity.test.mjs`）：`reasoning`/`input`/`contextWindow`/`maxTokens` 27/27 完全相同，`api` 26/27，`name` 26/27，`cost` 22/27，`compat`/`thinkingLevelMap` 21/27（差额来自 pi-ai 人工维护的价格修订与厂商方言，非列表接口可推断）。

## 安装

### 方式一：标准 `dsh plugin` 指令

```powershell
cd E:\path\to\dsh-opencode-go-model-list-fix
dsh plugin --profile web add .                       # link: 依赖，node_modules 指向本目录
# 或自包含的打包副本：
dsh plugin --profile web add file:E:\path\to\dsh-opencode-go-model-list-fix
```

`dsh plugin` 把参数转发给 profile 目录里的 pnpm，随后按**已安装状态**校对 `dsh.profile.bundles`：凡自带 `dsh.bundle.patch` 声明的依赖都会自动注册成 profile layer。本包已声明，所以一条命令即完成「写依赖 + 建 node_modules + 注册 bundle」。已在隔离 home 实测：`link:` 与 `file:` 都能注册并正常启动到 38 个模型；需要 PATH 上有 pnpm（本机 11.17.0）。

- `link:`：profile 的 node_modules 直接指向本目录，改代码即时生效，但目录不能移动/删除。
- `file:`：pnpm 按 `files` 白名单打包一份副本，自包含；升级要重新 `add`。
- 若某次 `bundles` 没写上（首次试验遇到过一次），再跑一次 `dsh plugin --profile web install` 会按已安装状态补注册。

### 方式二：`install.ps1`（不依赖 pnpm）

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1            # 默认 profile: web
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Profile tui
```

脚本只做两件事：把包复制到 `$DSH_HOME/profiles/<profile>/node_modules/dsh-opencode-go-model-list`，把包名追加到该 profile `package.json` 的 `dsh.profile.bundles`。**不碰 dsh 安装目录、不碰 `settings.yaml`、不碰凭据。** 实测 `pnpm install` / `pnpm add` 不会清理这种复制式安装（代价是它不在 pnpm 依赖图里，`update` 也不会升级它）。

重启 DSH 后应看到：

```text
[opencode-go-model-list] mounted: route=opencode-go gateway=https://opencode.ai/zen/go/v1/models ...
[opencode-go-model-list] route "opencode-go" resolved against the installed catalog: 27 shipped models, ...
[opencode-go-model-list] gateway=38, catalog=37 → 11 contributed (27 already served) in 2641ms
```

然后在 GUI 的模型选择器 / 设置 → 模型里就能选到 `DeepSeek V4.1 Flash` 等新模型。

卸载：`powershell -ExecutionPolicy Bypass -File .\uninstall.ps1`（可选 `-RemoveCache`）。dsh 磁盘上的 catalog 从未被修改，卸载即完全还原。

## 自带验证（不碰你正在用的 profile）

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-in-isolated-home.ps1 -Proxy http://127.0.0.1:7897
```

它会在 `.verify/dsh-home` 建一个隔离的 harness home，用 headless 模板起一个一次性 profile，装一个探针插件，分别在不装/装本插件的情况下真实启动 dsh，并通过 harness 自己的 LLM 服务 API（`ctx.llm.listModels('opencode-go')` / `resolveModelInfo`）打印结果。实测输出：

```text
===== without the plugin (shipped catalog) =====
[probe] count 27 after 24.5s
[probe] has-target deepseek-v4.1-flash=false kimi-k2.5=false
===== with the plugin (live catalog) =====
[probe] count 38 after 0.5s
[probe] has-target deepseek-v4.1-flash=true kimi-k2.5=true
[probe] resolve deepseek-v4.1-flash {"provider":"opencode-go","id":"deepseek-v4.1-flash","name":"DeepSeek V4.1 Flash",
  "inputModalities":["text","image"],"context":{"contextWindow":1000000},
  "reasoning":{"efforts":[{"id":"off",...},{"id":"low",...},{"id":"high",...},{"id":"max",...}]}}
```

## 配置（全部可选）

```yaml
- id: opencode-go-model-list
  name: 'dsh-opencode-go-model-list'
  config:
    provider: opencode-go                     # 要扩展的路由（默认就是自带路由）
    gatewayUrl: https://opencode.ai/zen/go/v1/models   # 套餐实际提供的模型
    catalogUrl: https://models.dev/api.json   # 元数据；置空则只用网关 + 兄弟模型
    refreshIntervalMs: 21600000               # 6 小时；0 = 只在启动时抓一次
    timeoutMs: 15000
    offline: false                            # 只用缓存、完全不联网
    includeDeprecated: true                   # 套餐仍在提供但 models.dev 标了 deprecated
    defaultApi: openai-completions
    updateExisting: false                     # true 时用实时元数据重写自带条目（默认绝不覆盖）
    patchCollection: true                     # 集合补丁（让后台刷新无需重启即生效）
    cachePath: ''                             # 默认 $DSH_HOME/cache/opencode-go-model-list/catalog.json
    extraModelIds: []                         # 除抓取结果外额外补的 id
    models:                                   # 逐模型覆盖
      deepseek-v4.1-flash:
        name: DeepSeek V4.1 Flash
        contextWindow: 1000000
      some-id:
        skip: true                            # 不要这个模型
    verbose: false
```

## 兼容性

- **只用自带路由**：插件从不调用 `llm.registerAdapter`、不注册任何 provider，`opencode-go` 仍是 `dsh-llm-pi-ai` 里由 pi-ai catalog provider 复用的那一个（协议实现、ambient 凭据发现、`apiKeyEnv` 全部不变）。
- **dsh-opencode-session-id**：它按路由名 + URL host（`opencode.ai`）注入 `x-opencode-session` 等头；注入的模型走同一路由、同一 baseURL，因此照常带上会话头。
- **dsh-cost-meter**：provider id / model id 命名不变（新模型是自带 catalog 的增量），且每条注入条目都带 `cost` 字段（取自 models.dev）。它自带的价目表是否覆盖新模型属于该插件的更新范围。
- **可逆**：自带条目永不被覆盖（除非显式 `updateExisting: true`）；插件卸载时按 id 撤回自己注入的条目并还原原型方法。

## 已知限制

- 线协议与 `compat` 是从自带 catalog 推断的：如果 opencode 为某个新模型选了一条与同族模型不同的协议，需要在该模型上显式写 `api`（配置里可逐模型覆盖）。
- models.dev 的价格/上限与 opencode 后台实际计费可能有出入（自带 catalog 本身也存在这种差异）；以网关实测为准。
- 首次运行需要能访问 `opencode.ai` 与 `models.dev`（走进程的代理环境变量，由 `@deepseek-ai/dsh-http-proxy` 统一接管，插件无需额外配置）。抓不到时保持自带 catalog 不变。

## 目录结构与测试

```text
lib/index.js     插件入口（cordis plugin: name / inject / apply，另有可测的 mount）
lib/config.js    配置归一化与默认值
lib/sources.js   两个上游的抓取与宽松解析
lib/mapping.js   从上游事实构建 pi-ai catalog 条目（推断规则都在这里）
lib/pi-ai.js     pi-ai 模块定位、catalog 注入/撤回、模型集合补丁
lib/cache.js     缓存读写（同步读 + 原子写）
test/            单测 / catalog 集成 / 保真度 / 端到端（35 个用例）
scripts/         隔离 home 验证脚本与探针插件
```

```powershell
npm test                    # 标准 node --test（会 spawn 子进程）
npm run test:in-process     # 单进程跑全部用例（受限沙箱里可用）
```
