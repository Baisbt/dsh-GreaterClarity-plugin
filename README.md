# dsh-greater-clarity（GreaterClarity）

DeepSeek Harness（DSH）Web 会话增强插件。在会话头部（「对话 / 轨迹」标签条右侧）提供三个入口：

- **折叠 / 展开（Switch）**：一键全局折叠所有 AI 的「思考链路」与「工具调用」，只保留每轮的最终回答；开关 ON=「折叠」、OFF=「展开」。
- **导出**：把当前会话导出为排版清晰的 Markdown，点击即下载到浏览器默认目录（无二次确认）。AI 只导出最终回答文本，用户只导出输入文本，图片用文件名指代；保留代码块 / 表格 / 列表结构。用户输入与附件文件名经过严格转义（反斜杠 / 结构符号 / 实体化 / 行首标记），阻断 Markdown 结构注入与裸 HTML 注入；AI 最终回答保持原样不转义。
- **设置**：左导航 + 右内容的弹窗，配置导出按钮显隐、AI 头像上传 / 大小（16–128px）/ 显隐。

此外：每条 AI 回复左侧显示可点击头像；点击头像可弹出「用户历史输入记录」悬浮窗（支持搜索、点击记录跳转到对应消息）；点击头像也可单独折叠 / 展开该轮 AI 的思考链 + 工具链（保留最终输出、绝不折叠用户内容）。手动折叠优先于全局开关，形成「全局折叠 / 全局展开 / 混合」三态。

顶部另有固定（sticky）头像：当视口内不存在**未被遮挡**的普通头像时显示（基于中心 + 四采样点的 `elementFromPoint` 命中测试判断可见性，session log 等浮层遮挡会被正确识别）；点击同样打开历史悬浮窗。从历史悬浮窗跳转后，悬浮窗会在滚动停稳后重新吸附到目标行头像旁，几何与直接点击该头像一致。

## 目录结构

```text
dsh-GreaterClarity-plugin/
├── package.json          # dsh.bundle.patch + dsh.client.inject/platform + peerDeps 范围声明
├── cordis.patch.yml      # 官方 dsh plugin add 的 insert 挂载声明
├── tsconfig.json         # NodeNext，exclude src/client
├── tsdown.config.ts      # host 自包含 ESM + client CJS(ModuleLoader banner)
├── scripts/build.sh      # junction link + tsc 编译 host
├── src/index.ts          # HOST：webServer 路由 + 设置持久化 + Markdown 导出
├── src/client/index.ts   # CLIENT：按钮、设置弹窗、折叠 CSS、头像层、导出触发
├── assets/DSH_Avatar.png # 默认头像
└── README.md
```

## 安装

### 方式 A：官方装配

```powershell
dsh plugin --profile web add <本目录绝对路径>
# 或发布到 npm 后：
dsh plugin --profile web add @dsh-external/dsh-greater-clarity
```

### 方式 B：运行时注入（开发）

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

## 已知限制

- **导出路径**：受浏览器安全限制，仅支持浏览器默认下载目录，无法自定义路径。
- **文件名**：会话日志只保留 `name`（已剥离本地路径），图片导出用文件名（+ 附件存储派生路径）指代，无法还原原始完整路径；普通文件以文本中的 `@路径` 引用原样保留。
- **维护依赖**：折叠 / 头像层与悬浮窗依赖 DSH 当前的稳定契约——服务名（`webServer`、`slots`、`sessionQuery`）、slot 名（`conversation.session.header.utilities`）、DOM 属性（`data-chat-flow-kind`、`data-variant="think"`、`data-chat-call-id`、`data-chat-anchor-key`、`data-conversation-scroll`）以及 Buttons 注入 props（`sessionId`、`useSession`），DSH 升级后需回归验证。
- **转义副作用**：用户输入经严格转义后，导出文档源码中会呈现 `\-`、`\*` 等反斜杠序列与 `&lt;` 等实体，渲染显示不受影响；行首 4+ 空格缩进的输入在导出中仍会呈现为代码块。
- **头像路径白名单**：设置中的 `avatarPath` 仅接受 `$DSH_HOME/greater-clarity/` 目录内的图片文件（安全约束，目录外路径会静默回退到上传头像 / 默认头像）；此前配置过外部路径的用户需把文件移入该目录或改用上传功能。

## 更新记录

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
