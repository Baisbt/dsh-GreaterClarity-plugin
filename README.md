# dsh-greater-clarity（GreaterClarity）

DeepSeek Harness（DSH）Web 会话增强插件。在会话头部（「对话 / 轨迹」标签条右侧）提供三个入口：

- **折叠 / 展开（Switch）**：一键全局折叠所有 AI 的「思考链路」与「工具调用」，只保留每轮的最终回答；开关 ON=「折叠」、OFF=「展开」。
- **导出**：把当前会话导出为排版清晰的 Markdown，点击即下载到浏览器默认目录（无二次确认）。AI 只导出最终回答文本，用户只导出输入文本，图片用文件名指代；保留代码块 / 表格 / 列表结构。
- **设置**：左导航 + 右内容的弹窗，配置导出按钮显隐、AI 头像上传 / 大小（16–64px）/ 显隐。

此外：每条 AI 回复左侧显示可点击头像；点击头像可单独折叠 / 展开该轮 AI 的思考链 + 工具链（保留最终输出、绝不折叠用户内容）。手动折叠优先于全局开关，形成「全局折叠 / 全局展开 / 混合」三态。

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
- **维护依赖**：折叠 / 头像层依赖 DSH 当前的稳定 DOM 属性（`data-chat-flow-kind`、`data-variant="think"`、`data-chat-call-id`），DSH 升级后需回归验证。
