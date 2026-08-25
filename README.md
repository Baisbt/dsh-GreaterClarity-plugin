# dsh-greater-clarity（GreaterClarity）

DeepSeek Harness（DSH）Web 会话增强插件。在会话头部（「对话 / 轨迹」标签条右侧）提供四个入口：

- **折叠 / 展开（Switch）**：一键全局折叠所有 AI 的「思考链路」与「工具调用」，只保留每轮的最终回答；开关 ON=「折叠」、OFF=「展开」。
- **导出**：把当前会话导出为排版清晰的 Markdown，点击即下载到浏览器默认目录（无二次确认）。AI 只导出最终回答文本，用户只导出输入文本，图片用文件名指代；保留代码块 / 表格 / 列表结构。用户输入与附件文件名经过严格转义（反斜杠 / 结构符号 / 实体化 / 行首标记），阻断 Markdown 结构注入与裸 HTML 注入；AI 最终回答保持原样不转义。导出走「客户端直出」：直接用浏览器内存中的会话快照本地生成下载（毫秒级响应），快照不可用时自动回退服务端路径。文件名规则见下。
- **历史**：打开/关闭「用户历史输入记录」快速定位面板，面板出现在按钮正下方。
- **设置**：左导航 + 右内容的弹窗，配置插件总开关（启用/停用）、导出按钮显隐、AI 头像上传 / 大小（16–128px）/ 显隐，底部提供一键卸载。

此外：每条 AI 回复左侧显示头像（纯展示，可开关/调大小/上传自定义），**头像下方带轮次标签**（第 N 轮）。

**历史快速定位面板**：打开后持续悬停（仅随「历史」按钮再次点击关闭）；顶部固定「回到顶部」按钮；每条记录带「第 N 轮」序号徽章，支持搜索与点击跳转（跳转定位到该输入第一行）。若会话存在未加载完全的更早历史（DSH 原生「加载更早」可补），顶部显示「历史未加载完全」提示。

**导出文件名规则**：标题取左侧工作区显示的会话名称（`displayTitle`）；时间戳取导出当日（点分格式，如 `2026.8.24`）；会话存在未加载完全的历史时加前缀——
- 未加载完全：`未加载完全历史对话_2026.8.24_会话标题.md`
- 已加载完全：`2026.8.24_会话标题.md`

**轮次语义**：每条用户输入独立一轮并递增编号（含运行期插入的中途引导/steering）——历史窗口序号、头像下方标签、导出文档轮次三处编号严格一致。

**状态持久化**：全局折叠/展开开关保存在 Host 设置文件中，刷新页面或重启服务后自动还原。

## 目录结构

```text
dsh-GreaterClarity-plugin/
├── package.json          # dsh.bundle.patch + dsh.client.inject/platform + peerDeps 范围声明
├── cordis.patch.yml      # 官方 dsh plugin add 的 insert 挂载声明
├── tsconfig.json         # NodeNext，exclude src/client
├── tsconfig.test.json    # 测试编译配置（src/pure + tests → build-test/）
├── tsdown.config.ts      # host 自包含 ESM + client CJS(ModuleLoader banner)
├── scripts/build.sh      # junction link + tsc 编译 host
├── LICENSE               # MIT
├── src/
│   ├── index.ts          # HOST：webServer 路由 + 设置持久化（纯逻辑引用 src/pure）
│   ├── pure/             # 双端共享纯函数（单一事实源，node:test 覆盖）
│   │   ├── markdown.ts       # 转义/事件流导出构建/文件名净化/时间格式
│   │   ├── rounds.ts         # 快照轮次采集/轮次映射/直出构建
│   │   └── settings-spec.ts  # 设置模型/净化/合并/clamp
│   └── client/
│       ├── index.ts          # CLIENT 入口：apply（样式/DOM 层装卸/slot 注册）
│       ├── state.ts          # 共享状态 + 宿主通信 + 设置同步
│       ├── use-store.ts      # React 订阅钩子
│       ├── styles.ts         # 主题 token CSS
│       ├── dom-layer.ts      # 头像/折叠 DOM 层 + 轮次映射缓存
│       ├── export-panel.ts   # 导出按钮（直出+兜底）
│       ├── history-panel.ts  # 历史快速定位面板
│       ├── settings-modal.ts # 设置弹窗
│       └── buttons.ts        # 会话头部按钮区
├── tests/                # node:test 单测（pure 层）
├── assets/DSH_Avatar.png # 默认头像
└── README.md
```

## 安装

### 方式 A：从 GitHub 源码安装（外部用户推荐）

```sh
dsh plugin --profile web add github:Baisbt/dsh-GreaterClarity-plugin
```

首次安装 pnpm 会拦截 `prepare` 构建脚本（allowBuilds 授权，源码安装的标准流程）：把 pnpm 打印的 `@dsh-external/dsh-greater-clarity@...` 键**原样**加入该 profile 的 `pnpm-workspace.yaml`（`allowBuilds: "<键>": true`；键随解析方式存在 git/codeload 两种形态，可同时保留多把），然后重跑一次安装命令即可。装入 **web profile**（含 `dsh-web-app`，提供本插件依赖的 webServer 服务）。

### 方式 B：本地目录 / npm

```powershell
dsh plugin --profile web add <本目录绝对路径>
# 或发布到 npm 后：
dsh plugin --profile web add @dsh-external/dsh-greater-clarity
```

### 方式 C：运行时注入（开发）

```powershell
# 在 DSH 会话内使用注入器工具：
#   dev_build_plugin  -> dev_inject_plugin
```

## 构建

```powershell
# 需 DSH_CHECKOUT 指向 dsh 源码 checkout（含 packages/）
$env:DSH_CHECKOUT = "D:\dsharness\deepseek-harness"
bash scripts/build.sh        # link 依赖 + tsc 编译 host
npm run build:client         # tsdown 打包 host + client
```

## 设置持久化

设置写入 `$DSH_HOME/greater-clarity/settings.json`；上传的头像落盘 `$DSH_HOME/greater-clarity/avatar.<ext>`；默认头像来自包内 `assets/DSH_Avatar.png`。三处均通过 Host 路由 `/dsh-greater-clarity/*` 读写。

## 卸载与停用

三种粒度，按需选择：

| 需求 | 操作 | 效果 |
|---|---|---|
| 临时停用（保留设置） | 设置弹窗 → 「启用 GreaterClarity」开关关闭 | 全部功能与 DOM 层下线，会话头部仅留「启用」按钮；重启后保持停用 |
| 软卸载（清除数据） | 设置弹窗 → 底部「卸载插件…」（双确认） | 清空 `$DSH_HOME/greater-clarity/`（设置 + 头像），写入 `uninstalled.flag` 停用标记，跨重启生效；重新「启用」即恢复默认配置 |
| 彻底移除（profile 级） | 终端运行 `dsh plugin --profile <名称> remove @dsh-external/dsh-greater-clarity` | 从 profile 组合中移除 bundle 层，插件不再加载；建议先用软卸载清掉数据目录 |

> 说明：bundle 插件由 profile 配置层装配，「彻底移除」必须走官方 `dsh plugin remove` 命令——这是 DSH 的架构约定；弹窗内的卸载按钮负责的是数据清理与停用标记。

## 已知限制

- **导出路径**：受浏览器安全限制，仅支持浏览器默认下载目录，无法自定义路径。
- **文件名**：会话日志只保留 `name`（已剥离本地路径），图片导出用文件名（+ 附件存储派生路径）指代，无法还原原始完整路径；普通文件以文本中的 `@路径` 引用原样保留。
- **维护依赖**：折叠 / 头像层与悬浮窗依赖 DSH 当前的稳定契约——服务名（`webServer`、`slots`、`sessionQuery`）、slot 名（`conversation.session.header.utilities`）、DOM 属性（`data-chat-flow-kind`、`data-variant="think"`、`data-chat-call-id`、`data-chat-anchor-key`、`data-conversation-scroll`）以及 Buttons 注入 props（`sessionId`、`useSession`），DSH 升级后需回归验证。
- **转义副作用**：用户输入经严格转义后，导出文档源码中会呈现 `\-`、`\*` 等反斜杠序列与 `&lt;` 等实体，渲染显示不受影响；行首 4+ 空格缩进的输入在导出中仍会呈现为代码块。
- **导出直出依赖**：客户端直出读取会话对象层快照的 `chat.order`/`chat.nodes` 结构（防御式读取，异常自动回退服务端）；标题在快照无 title 时取首条用户输入前 24 字。快照结构与 Host 端 sessionQuery 属同类非契约依赖，DSH 升级需回归。
- **头像路径白名单**：设置中的 `avatarPath` 仅接受 `$DSH_HOME/greater-clarity/` 目录内的图片文件（安全约束，目录外路径会静默回退到上传头像 / 默认头像）；此前配置过外部路径的用户需把文件移入该目录或改用上传功能。
- **导出文件名前缀语义**：「未加载完全历史对话_」前缀仅出现在**客户端直出**路径（直出只含已加载窗口）；服务端兜底读盘为全量事件，文件名恒无前缀。
- **面板定位**：面板锚定「历史」按钮下方，窗口缩放时随渲染即时校正；极端窄窗口下可能钳制在屏幕内边缘。
- **设置并发模型**：单页面内并发 load/save 以请求序号守卫（仅采纳最新响应）；多开 DSH Web 标签页时设置为「最后写赢」，无跨页协商。
- **cordis peer 范围**：`peerDependencies.cordis` 为 `*`（本插件对 cordis 仅类型导入、运行时零引用，避免 semver 预发布元组排除陷阱）。

## 更新记录

### 0.10.2 隐性问题修复

1. **兜底导出前缀语义修正**：服务端兜底读盘即全量事件，文件名恒无「未加载完全」前缀（原实现会产出内容完整却命名为不完整的文件）；前缀语义归位至直出路径。
2. **面板 resize 即时校正**：窗口缩放时历史面板重新计算「历史」按钮下方锚定位置。
3. **设置并发守卫**：load/save 请求序号化，仅采纳最新响应，消除快速连续操作时的乱序覆盖。
4. **cordis peer 范围修正**：`>=4.0.0-rc <5` 存在 semver 预发布元组排除陷阱（未来 4.1.0-rc.\* 将 ERESOLVE），改为 `*`（运行时零依赖，仅类型声明）。
5. README 已知限制同步以上四项；版本 0.10.1 → 0.10.2。

### 0.10.0 架构解耦重构（行为不变）

1. **`src/pure/` 共享纯函数层**：转义/导出构建/文件名/轮次映射/设置模型抽取为双端共享单一事实源，消除 Host/Client 四处手工同步的副本；`buildMarkdown` 与 `snapshotToMarkdown` 统一装配段（`roundsToMarkdown`），并顺带修复头部「对话轮数」与实际轮数不一致的旧问题。
2. **设置模型单一事实源**：`settings-spec.ts` 提供类型/默认值/逐字段净化/合并/clamp，Host 净化与 Client 合并共享同一实现，新增设置字段触点从 6 处降至 2 处。
3. **Client 拆分 7 模块**：state / use-store / styles / dom-layer / export-panel / history-panel / settings-modal / buttons（752 行巨石 → 职责单一模块）。
4. **轮次映射 DOM 层自持**：映射改由 dom-layer 经 sessions 服务自持刷新（Buttons 仅注入当前会话 id），解除对 React 渲染副作用的隐式依赖——导出按钮隐藏/面板未开时头像标签依然正确。
5. **测试基建**：`tests/` + `node:test`（`npm test`），pure 层 40+ 断言固化（转义向量/轮次语义/导出构建/设置净化/文件名规则）。
6. 版本号 0.9.1 → 0.10.0；行为无变化（纯结构重构）。

### 0.9.1 面板持久悬停 + 导出标题对齐侧栏

1. **面板持久悬停**：历史面板不再随点击外部关闭，仅随「历史」按钮再次点击开关。
2. **导出标题对齐侧栏**：文件名标题优先取 sessions 列表 store 的 `displayTitle`（与左侧工作区显示一致），回退快照标题链；服务端兜底维持 `readTitle` 权威来源。
3. 版本号 0.9.0 → 0.9.1。

### 0.9.0 快速定位触发迁移 + 导出文件名规则

1. **触发方式变更**：快速定位改由会话头部的「历史」按钮触发（位于「设置」之前，点击开/关面板）；AI 头像变为纯展示（不再响应点击），顶部 sticky 头像连同移除。
2. **面板位置变更**：面板锚定在「历史」按钮正下方（左缘对齐按钮、顶 = 按钮底 + 8px），不再基于头像或屏幕中心定位；相关头像锚定机制（停稳等待/代际令牌/锚点回退链）整体移除。
3. **文案调整**：历史记录序号徽章由 `#N` 改为「第 N 轮」；会话存在未加载完全的更早历史时（快照 `hasMore`），「回到顶部」旁显示「历史未加载完全」提示。
4. **导出文件名规则**：时间戳取导出当日点分日期（`2026.8.24`）；会话存在未加载完全的历史时文件名加前缀 `未加载完全历史对话_`。客户端直出按快照 `hasMore` 判定；服务端兜底由请求体 `partial` 字段传入。
5. 版本号 0.8.2 → 0.9.0。

### 0.8.2 清理冗余

1. 删除无调用的 `textOf` 死函数；删除从未被功能使用的 `export.mode` / `export.targetDir` 设置字段（导出恒为浏览器默认下载，设置页同步移除「导出路径」提示行）。
2. 修正 README 失实描述：移除「点击头像单独折叠该轮 / 三态」段落（该能力已被历史窗口取代，现头像点击即弹历史窗），确保描述与代码一致。
3. 移除已取消的 0.8.1（回到顶部自动加载）变更记录；版本号 0.8.1 → 0.8.2。

### 0.8.0 快速定位窗口定位规则调整

1. **取消移动动画**：移除跳转重吸附时的 260ms 平移过渡，窗口位置即时生效。
2. **定位规则调整**：水平保持紧贴 AI 头像左侧（右缘 = 头像左缘 - 8px），头像尺寸变化时随其左缘像素级偏移；垂直改为**窗口中心恒定屏幕中间高度**，不再随头像位置或其他因素变化。

### 0.7.0 快速定位修复 + 收录规范达标

1. **定位到输入第一行**：跳转改为行顶对齐滚动容器顶部（留 12px 边距），长输入不再垂直居中导致首行不可见。
2. **吸附偏差与连点竞态修复**：停稳等待支持取消——新点击立即作废旧回调；吸附锚点优先取视口内的目标头像（与直接点击同几何），头像滚出视口时回退锚定行首左侧。
3. **平滑重吸附动画**：跳转后面板以 260ms 平移到目标位置；打开瞬间仍瞬时定位。
4. **边界检测增强**：垂直钳制改用实测面板高度，水平/垂直双向保证面板完整可见。
5. **收录规范达标**：新增 LICENSE（MIT）；package.json 补充 repository/homepage/bugs 元数据。仓库提交数与年龄达到 Awesome DSH Plugin 门槛后，可用 `docs` 外的 `ui` 分类提交收录 PR。

### 0.6.0 序号修复 + 深色适配审计

1. **序号全为 #1 修复**：经 DSH 源码核实，仅开启新轮的输入是 `kind==='user'`，agent 运行期插入的追问一律是 `'steering'`（harness 场景占多数），旧计数逻辑只对 user 递增导致几乎全部同号。轮次语义改为「每条用户输入独立递增」，历史序号 / 头像标签 / 导出轮次三处同步。
2. **深色外观适配审计**：逐条核对全部 CSS 令牌。修复序号徽章深色下不可见（原用品牌反转色作底+硬编码白字；改用双主题自适应的 `--dsw-alias-button-info-fill` 蓝）；卸载按钮的错误令牌 `--dsw-alias-danger` 不存在，改为 `--dsw-alias-state-error-primary`；其余令牌（表面/边框/文字/悬停/三级标签）均经 design-platform.css 源码核实有效。
3. 版本号 0.5.0 → 0.6.0。

### 0.5.0 轮次标识 + 回到顶部 + 折叠状态持久化

1. **轮次序号体系**：新增 key→轮次映射（user 开新轮、steering 归属当前轮），历史记录窗口每条记录显示 `#N` 序号徽章，AI 头像下方显示「第 N 轮」标签，三处与导出文档轮次编号保持一致；导出同步纳入 steering 内容并采用相同轮次划分。
2. **回到顶部**：历史悬浮窗顶部新增固定「回到顶部」项（不随列表滚动），点击将会话滚动容器置顶定位到最早消息。
3. **折叠状态持久化**：全局折叠/展开开关写入 Host 设置文件（`ui.foldGlobal`），刷新页面或重启服务后自动还原。
4. 版本号 0.3.0 → 0.5.0。

### 0.3.0 导出提速

1. **客户端直出主路径**：导出按钮直接订阅会话对象层不可变快照，本地遍历 `chat` 节点构建 Markdown 并触发下载——零网络往返、零磁盘读取，长会话从「秒级等待」降为毫秒级响应；轮次分组以 user/steering 节点为边界，转义规则与 Host 端保持一致（副本同步维护）。
2. **服务端兜底保留**：快照缺失或结构异常时自动回退原 `/export` 路径；兜底路径的 `readSession`/`readTitle` 改为并行读取。
3. 版本号 0.2.0 → 0.3.0。

### 0.2.0 卸载与停用

1. **插件总开关**：设置弹窗新增「启用 GreaterClarity」；关闭后 DOM 层（头像/折叠/sticky/监听器）全部释放，会话头部仅保留「启用」入口，重启保持停用。
2. **一键软卸载**：设置弹窗底部「卸载插件…」（双确认）→ 清空数据目录 → 写入 `uninstalled.flag` 持久停用标记 → 弹出官方彻底移除命令指引；重新启用即清除标记恢复默认配置。
3. Host 新增 `POST /dsh-greater-clarity/uninstall` 路由（受同源/回环信任校验保护）；设置结构新增 `plugin.enabled` 字段（旧配置文件自动补默认值）。
4. 版本号 0.1.0 → 0.2.0。

### 0.1.0 安全与健壮性批次

**安全**
1. **任意文件读取修复**：`avatarPath` 白名单限定在 greater-clarity 目录内且扩展名必须是图片，杜绝经 settings 写入任意路径后借 `/avatar` 路由读取机器文件。
2. **路由信任校验**：移除 `Access-Control-Allow-Origin: *`；所有插件路由要求 Host 为本机回环地址（防 DNS rebinding），浏览器跨站请求的 Origin 必须与 Host 同源（防 CSRF）。外部工具经 `http://127.0.0.1:<port>` 直连不受影响。

**正确性**
3. **导出丢首轮修复**：事件流不以 `turn/start` 开头时（部分快照/回放窗口），已积累内容按独立轮输出而非丢弃。
4. **跳转吸附容器覆盖**：滚动停稳检测改为捕获阶段监听全文档 scroll（静默 150ms 停稳 / 1200ms 兜底），不再依赖固定的 `[data-conversation-scroll]` 容器签名。
5. **空 step 轮不再整体隐藏**：折叠分组中某轮没有最终回答行时保持该轮原样可见。
6. **请求体超限**：以暂停读取 + 413 状态码响应取代直接断连；错误响应对已销毁套接字的二次写异常就地吞掉，消除未处理 rejection。
7. **悬浮窗跟随窗口缩放**：HistoryPanel 打开时窗口 resize 会重算吸附位置。

**健壮性**
8. **settings.json 损坏备份**：解析失败时先把旧文件改名 `.bak` 再回默认值，不无提示覆盖。
9. **POST 设置逐字段类型净化**：非法类型不落盘；数值字段统一 clamp。

### 0.1.0 修复批次

1. **头像可见性遮挡判定**：sticky 头像显隐判断从「仅视口相交」升级为采样点命中测试（中心 + 四内对角点，`elementFromPoint` 必须命中头像自身），被 session log 栏等浮层遮挡的头像不再误判为可见。
2. **导出 Markdown 注入防护**：新增 `escapeUserText` 全局严格转义用户输入与附件文件名，阻断伪造标题/分隔线/列表/注释及裸 HTML 注入；AI 回答不转义。
3. **历史跳转悬浮窗吸附**：历史记录跳转平滑滚动停稳后，悬浮窗重新吸附到目标行头像旁，几何与直接点击一致。
