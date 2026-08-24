<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&height=190&color=0:102a2a,45:176b5b,100:e56b4f&text=Slide%20Studio&fontColor=ffffff&fontSize=52&fontAlignY=36&desc=AI%20Native%20Visual%20Novel%20Studio&descAlignY=58&animation=fadeIn" width="100%" alt="Slide Studio" />

<img src="frontend/public/assets/slide-logo.png" width="96" alt="Slide Studio logo" />

<a href="https://github.com/kylemarvin884/Hikari-Studio/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/kylemarvin884/Hikari-Studio/ci.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=white&label=Build" alt="Build status" /></a>
<img src="https://img.shields.io/badge/Platform-Windows-16706a?style=for-the-badge&logo=windows11&logoColor=white" alt="Windows" />
<img src="https://img.shields.io/badge/Python-3.12-e56b4f?style=for-the-badge&logo=python&logoColor=white" alt="Python 3.12" />
<img src="https://img.shields.io/badge/React-19-202b33?style=for-the-badge&logo=react&logoColor=61dafb" alt="React 19" />
<img src="https://img.shields.io/badge/TypeScript-Strict-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript Strict" />
<a href="LICENSE"><img src="https://img.shields.io/github/license/kylemarvin884/Slide-Studio?style=for-the-badge&color=176b5b" alt="MIT License" /></a>
<a href="https://github.com/kylemarvin884/Hikari-Studio/releases"><img src="https://img.shields.io/github/v/release/kylemarvin884/Hikari-Studio?include_prereleases&style=for-the-badge&color=e56b4f" alt="Latest release" /></a>

<br /><br />

<a href="https://git.io/typing-svg"><img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=600&size=20&pause=1100&color=176B5B&center=true&vCenter=true&width=760&lines=%E7%94%A8+Block+%E5%86%99%E4%B8%8B%E6%95%85%E4%BA%8B%EF%BC%8C%E7%94%A8%E5%8F%AF%E8%A7%86%E5%8C%96%E6%BC%94%E5%87%BA%E8%AE%A9%E5%AE%83%E5%8F%91%E7%94%9F;Python+Desktop+Host+%C2%B7+React+Editor+%C2%B7+Shared+TypeScript+Runtime;Make+visual+novels+feel+simple%2C+without+making+the+engine+simple" alt="Slide Studio typing introduction" /></a>

**面向创作者的本地 Galgame 可视化编辑器。** 让剧本、演出、素材、调试与构建留在同一个安静、完整的制作环境中。

[下载预览版](https://github.com/kylemarvin884/Hikari-Studio/releases) · [功能概览](#-功能概览) · [快速开始](#-快速开始) · [技术架构](#-技术架构) · [开发进度](#-开发进度)

</div>

> [!IMPORTANT]
> Slide Studio 仍处于积极开发阶段，当前仓库是可运行的工程预览版，不代表稳定发行版。项目格式会提供迁移能力，但公开 API 仍可能调整。

## 下载与版本

<p align="center">
  <a href="https://github.com/kylemarvin884/Hikari-Studio/releases/download/v0.4.0-beta.1/Slide-Studio-Setup-0.4.0-beta.1.exe"><img src="https://img.shields.io/badge/下载-Windows%20安装包-e56b4f?style=for-the-badge&logo=windows11&logoColor=white" alt="下载 Windows 安装包" /></a>
  <a href="https://github.com/kylemarvin884/Hikari-Studio/releases/download/v0.4.0-beta.1/Slide-Studio-Portable-0.4.0-beta.1.zip"><img src="https://img.shields.io/badge/下载-Portable%20便携版-176b5b?style=for-the-badge&logo=windows11&logoColor=white" alt="下载 Portable 便携版" /></a>
  <a href="https://github.com/kylemarvin884/Hikari-Studio/releases"><img src="https://img.shields.io/badge/查看-全部版本-202b33?style=for-the-badge&logo=github&logoColor=white" alt="查看全部版本" /></a>
</p>

最新公开预览版为 `v0.4.0-beta.1`。该版本带来完整演出时间轴、大型项目优化、统一构建前检查、SaveGame 恢复、更新与崩溃报告闭环，以及更完整的桌面导入与构建体验。Release 页面同时提供 `latest.json` 和 SHA-256 清单。

> [!WARNING]
> 这是未签名的 Windows 预览版，安装前请核对 [`SHA256SUMS.txt`](https://github.com/kylemarvin884/Hikari-Studio/releases/download/v0.4.0-beta.1/SHA256SUMS.txt)。编辑器使用 Qt WebEngine；Windows 游戏可导出为轻量系统浏览器版或包含 CefSharp Chromium 的内置浏览器版。Ren'Py 导出仍是有限兼容。

安装包校验示例：

```powershell
Get-FileHash .\Slide-Studio-Setup-0.4.0-beta.1.exe -Algorithm SHA256
Get-FileHash .\Slide-Studio-Portable-0.4.0-beta.1.zip -Algorithm SHA256
```

## 编辑器预览

<p align="center">
  <img src="docs/images/editor-overview.png" width="100%" alt="Slide Studio 剧本编辑、实时预览与属性检查器" />
</p>

<div align="center"><sub>剧本 Block 编辑 · 游戏实时预览 · OP 定位 · 属性检查器</sub></div>

## 功能概览

| 工作区 | 当前能力 |
| --- | --- |
| **项目启动中心** | 最近项目、固定项目、新建与打开；四步创建向导支持模板、路径、画布、作者与高级窗口配置 |
| **剧本编辑** | 对白、旁白、场景、声音、角色演出、变量、条件、分支、跳转与 Fragment 调用 |
| **四种视图** | 卡片编辑、纯文本、Ren'Py 风格摘要、底层 JSON OP |
| **角色与场景** | 每个表情独立立绘、多层场景、视差距离、图层偏移、立绘拖拽与吸附辅助线 |
| **资源管线** | 图片、音频、视频、字体管理，引用分析、缺失诊断、强制打包与文件夹批量修复 |
| **叙事地图** | 可移动流程节点、章节与 Fragment 关系、变量因果追踪、分支连线、自顶向下流程图显示模式 |
| **演出时间轴** | 多轨道编排、裁剪、跨轨拖动、框选、波纹编辑、分组折叠、标记与循环区间、音频波形和贝塞尔关键帧 |
| **实时调试** | 编辑器与 OP 双向定位、变量观察、调用栈、Console、快速存档与流程回滚 |
| **游戏运行时** | 打字机文本、自动播放、快进、历史、存读档、音量与文本速度设置 |
| **双主题系统** | 四套编辑器主题、强调色、减少动效，以及独立的游戏对白、菜单和存档界面主题编辑器 |
| **构建发布** | Web 游戏、可选系统浏览器或 CefSharp 内置内核的 Windows 游戏、Ren'Py 导出，以及基于 Nuitka、PySide6 与 Inno Setup 的编辑器安装程序 |
| **桌面维护** | Stable/Beta 更新通道、24 小时检查缓存、SHA-256 校验、显式安装确认、安装包回退和本地崩溃报告预览 |
| **AI Agent** | 模型发现与故障转移、流式任务、检查点分支、结构化 Patch、导演模式、制作记忆和全分支模拟 |

<details>
<summary><strong>展开查看素材健康与自动修复规则</strong></summary>

- 统一检查角色立绘、角色覆盖层、场景图层与游戏 UI 图片。
- 按 SHA-256、完整文件名、扩展名和文件大小递归匹配迁移后的素材目录。
- 冲突候选不会静默写入；所有批量替换先预览，再由用户确认。
- 替换保留稳定素材 ID，因此角色、场景、剧本和 UI 引用会同步刷新。

</details>

## 技术架构

```mermaid
flowchart LR
    Creator["创作者"] --> Editor["React + TypeScript 编辑器"]
    Editor <--> Bridge["FastAPI localhost RPC"]
    Bridge <--> Host["Python 桌面宿主"]
    Host --> FS["v3 目录项目 / 文件系统"]
    Host --> Build["构建 / Git / AI / 系统能力"]
    Editor --> Core["engine-core"]
    Editor --> Timeline["舞台与演出时间轴"]
    Core --> Preview["编辑器实时预览"]
    Core --> Web["Web 游戏"]
    Core --> Win["Windows 系统浏览器 / CefSharp 游戏"]
    Timeline --> Core
```

编辑器预览、Web 游戏和 Windows 游戏共享同一套 TypeScript `engine-core`，避免三套运行逻辑逐渐产生行为差异。

## AI 制作 Agent

Slide Agent 不是单独的聊天窗口，而是可以读取项目上下文、调用受控工具并持续执行制作任务的工作流。用户只需配置兼容接口 URL 与 API Key；密钥由桌面宿主保存，不进入项目文件。

```mermaid
flowchart LR
    Goal["自然语言制作目标"] --> Queue["项目级任务队列"]
    Queue --> Provider["模型发现 / 健康评分 / 故障转移"]
    Provider --> Stream["流式推理与实时状态"]
    Stream --> Tools["查询 / 剧本编辑 / 诊断 / 构建工具"]
    Tools --> Checkpoint["可恢复执行检查点"]
    Checkpoint --> Review["结构化修改确认"]
    Checkpoint --> Branch["选择任意历史节点重新执行"]
    Branch --> Stream
```

- 从上游 `/models` 自动发现模型，按能力、健康度与可用性推荐，并支持手动模型 ID 兜底。
- 健康结果使用 TTL 缓存、后台重测和熔断恢复，调用失败时自动切换到可用模型。
- 长任务提供流式文本、步骤状态、暂停、继续和 Provider 级请求中止。
- 会话与检查点保存在项目 `.slide/agent/sessions`，可以在可视化时间线中选择任意历史节点派生重跑。
- 历史重跑创建独立派生任务，原始任务、事件和结果保持不变；检查点内部执行状态不会暴露到前端。
- 制作记忆保存世界观、角色规则、剧情事实和文风约束，并在 Agent 写作前参与一致性检查。
- 导演模式可以编排场景、角色、镜头、音频与转场，结果统一进入逐项确认、冲突检测、原子应用和语义撤销流程。
- 全分支模拟由共享 `engine-core` 在 Web Worker 中执行，提供进度、取消、缓存、覆盖率、死路与循环诊断。

## v0.4 Beta 稳定化

编辑器维护中心将软件更新和崩溃恢复放在同一套本地桌面流程中，但保持两个明确边界：安装更新必须由用户确认，崩溃报告必须先在本机预览并再次确认才会上传。

```mermaid
flowchart LR
    Release["GitHub Release + latest.json"] --> Check["24 小时更新检查"]
    Check --> Download["下载到本机"]
    Download --> Verify["大小与 SHA-256 校验"]
    Verify --> Confirm["用户确认安装或回退"]
    Crash["Python / React / Promise 异常"] --> Redact["写盘前脱敏"]
    Redact --> Preview["本地报告预览"]
    Preview --> Consent["用户确认上传"]
    Consent --> Collector["FastAPI 自建收集服务"]
```

- `latest.json` 描述版本、通道、安装包地址、大小、SHA-256 和发行说明。
- 已校验安装包最多保留两个版本；安装或回退前会再次校验，不进行静默升级。
- Python 主线程、后台线程、React Error Boundary 和未处理 Promise 会进入同一份本地报告队列。
- API Key、Authorization、用户目录、项目正文、素材内容和 Agent 原始提示会在写入磁盘前移除。
- 自建收集端位于 `services/crash-collector/`，使用 FastAPI、PostgreSQL 与 S3 兼容对象存储，限制单份报告 1 MB、每 IP 每小时 5 次。
- `v*` tag 会触发测试、Nuitka、Inno Setup、Portable ZIP、校验清单和 GitHub Release 自动发布；包含连字符的版本会标记为 Pre-release。

| 目录 | 职责 |
| --- | --- |
| `backend/` | Python 桌面宿主、项目存储、桌面 API、导入与构建能力 |
| `frontend/src/` | React + TypeScript 编辑器界面 |
| `native/asset-worker/` | Rust 素材扫描与并行 SHA-256 Worker |
| `frontend/src/engine-core/` | Block 注册、运行状态、诊断和共享执行逻辑 |
| `frontend/src/core/timeline.ts` | 演出时间轴计算、吸附、波纹编辑、关键帧与运行时求值 |
| `frontend/src/runtime/` | 导出游戏使用的玩家运行时 |
| `launcher/Slide.GameLauncher/` | .NET 8 Windows 游戏启动器；按导出选择生成轻量系统浏览器版或 CefSharp 内置版 |
| `data/star-sea-echo/` | v3 格式示例项目 |
| `tests/` | Python 项目存储、API、导入、导出和构建测试 |

## 快速开始

### 环境要求

- Windows 10/11
- [uv](https://docs.astral.sh/uv/)（自动管理 Python 3.12/3.13 与虚拟环境）
- Node.js 22+ 与 pnpm 10+
- Rust stable；用于构建素材扫描与并行哈希 Worker
- .NET 8 SDK，仅在构建 Windows 游戏时需要

### 运行桌面编辑器

```powershell
git clone https://github.com/kylemarvin884/Hikari-Studio.git
cd Slide-Studio
uv sync

cd frontend
pnpm install --frozen-lockfile
pnpm build
cd ..

uv run run.py
```

Windows 用户也可以在依赖安装完成后运行 `start.bat`（优先使用 `uv run`）。

桌面版默认使用 Windows 标准目录：

- 项目：`文档/Slide Studio/Projects`
- 构建：`文档/Slide Studio/Builds`
- 配置、日志与缓存：`%LOCALAPPDATA%/Slide Studio`

首次启动会复制旧版仓库 `data/` 中的项目，源文件不会被删除。传入 `--portable` 可改用程序目录旁的 `projects` 与 `user-data`。

### 构建独立 Windows 编辑器

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-editor.ps1
```

编辑器使用 Nuitka 编译为 Windows 本机 standalone 程序，产物位于 `dist/SlideStudio/SlideStudio.exe`，运行时不需要用户安装 Python、Node.js 或 pnpm。Windows 游戏构建所需的轻量系统浏览器启动器和 CefSharp 内置启动器都会预编译进编辑器目录；实际导出只复制所选模式，系统浏览器版不会携带 Chromium 运行时。

Nuitka 2.x 的 Windows DLL 扫描器要求 **Python 基础安装目录使用纯 ASCII 路径**。当仓库或 Python 位于含中文字符的目录时，请先在 ASCII 路径准备一个 Python 3.12/3.13 解释器（例如 `uv python install 3.12 --install-dir C:\SlideBuild`），并通过 `-Python C:\SlideBuild\...\python.exe` 指定基础解释器；脚本会用它创建 `.venv` 并再次校验该条件。Nuitka 暂存与缓存目录也可分别通过 `SLIDE_NUITKA_STAGING` 和 `SLIDE_NUITKA_CACHE` 指向纯 ASCII 路径。

可选的语音识别依赖（`faster-whisper`）通过 `uv sync --extra asr` 安装；构建依赖（Nuitka 等）通过 `--extra build` 安装。

旧版编辑器仍在运行时，可以使用 `-OutputDirectory dist/SlideStudio-next` 生成侧边构建；随后将同一目录传给 `build-installer.ps1 -SkipEditor -EditorDirectory dist/SlideStudio-next`，无需覆盖被占用的运行目录。

### 构建 Windows 安装程序

安装 [Inno Setup 6 或更高版本](https://jrsoftware.org/isinfo.php) 后运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-installer.ps1
```

安装程序输出到 `dist/installer/`，采用当前用户安装，不要求管理员权限。编辑器会随安装包携带 Qt WebEngine 运行时；Windows 游戏启动器仍按导出模式使用系统浏览器或 CefSharp。安装程序创建开始菜单快捷方式、标准卸载入口，并将 `.slide` 项目文件关联到 Slide Studio。CI 也会生成可下载的安装程序 Artifact。

### 部署崩溃报告服务

```powershell
cd services/crash-collector
Copy-Item .env.example .env
docker compose up --build -d
Invoke-RestMethod http://127.0.0.1:8080/health
```

部署前必须替换 `.env` 中的数据库、MinIO、管理令牌和 IP 哈希盐，并在反向代理上终止 TLS。编辑器通过 `SLIDE_CRASH_REPORT_URL=https://your-host/v1/crash-reports` 指向服务；未配置时报告只保留在本机。

### 前端开发模式

```powershell
cd frontend
pnpm dev
```

浏览器开发模式使用本地缓存模拟项目存储；通过 `uv run run.py` 启动时，文件系统与系统能力会自动切换到 Python Desktop API。

## 项目格式

Slide v3 使用适合 Git diff 与团队协作的目录结构：

```text
project.slide.json
chapters/*.json
scripts/*.json
characters/*.json
scenes/*.json
timelines/*.json
assets/index.json
assets/files/*
locales/zh-CN.json
settings/editor.json
ui/theme.json
.slide/agent/memory.json
```

打开 v1/v2 项目时会先生成带时间戳的备份，再迁移到 v3。项目写入采用临时文件原子替换，并维护本地崩溃恢复副本。

## 开发进度

```text
工程基础与 v3 项目格式   ██████████  完成
项目启动与桌面体验       █████████░  安装版可用
编辑器设计系统与多主题   ████████░░  全工作区迁移中
核心运行时与编辑器接线   ████████░░  持续完善
舞台与演出时间轴         █████████░  正式编辑能力可用
生产级资源管线           ███████░░░  开发中
全局 AI 制作 Agent       ████████░░  智能制作闭环可用
Windows / Web 发布       █████████░  更新与崩溃闭环已接入
```

接下来的重点：

1. 用完整示例项目持续扩展安装版内容级回归，覆盖长剧情、复杂分支和多角色演出。
2. 完成更新下载中断、安装回退、崩溃服务故障与用户授权上传的真实环境验收。
3. 继续降低大型项目的 Qt WebEngine 传输、React 首次渲染和时间轴冷定位开销。
4. 收集 Beta 反馈、处理高 DPI 与 Windows 10/11 兼容问题，并为后续代码签名接入 PFX。

完整阶段规划见 [`docs/phase-2-roadmap.md`](docs/phase-2-roadmap.md)。

## 验证

```powershell
uv run --no-sync python -m unittest discover -s tests -q
cargo fmt --all -- --check
cargo test --workspace --locked

cd frontend
pnpm test
pnpm run typecheck
pnpm run build
pnpm exec playwright test
```

最近一次本地 Windows 验证结果：Python `174` 项、崩溃收集服务 `4` 项、Vitest `118` 项、Playwright `33` 项通过；TypeScript 严格检查、编辑器与游戏运行时生产构建、Nuitka standalone 和 Inno Setup `v0.4.0-beta.1` 安装包构建均通过。GitHub runner 的 Windows 短路径规范化测试正在修复中，不影响本 Release 附件。

安装版还通过了以下真实桌面流程：

- 创建示范项目并生成完整 v3 目录。
- 关闭并重启编辑器后，从最近项目继续打开。
- 在编辑器运行时双击 `.slide`，由现有单实例接管并切换项目。
- 自动备份 v2 单文件项目，再迁移为 v3 目录项目。
- `v0.4.0-beta.1` standalone 通过项目路径冷启动并直接进入编辑器，运行设置与应用维护保持独立入口。
- 维护中心在真实 Qt WebEngine 窗口中完成更新通道、安装包回退与本地崩溃报告空状态检查。

每次推送和 Pull Request 都会在 Windows runner 上执行 Python 测试、TypeScript 检查、Playwright、两套前端构建、.NET 启动器、Nuitka 与 Inno Setup 验证，并在 Linux runner 上验证崩溃报告服务。

## 安全约定

- AI API Key 不写入项目、日志、崩溃报告或游戏构建包。
- Agent 的写入操作必须先展示结构化修改并由用户确认。
- 删除、覆盖和发布构建使用单独确认级别。
- 本地恢复文件、编辑器设置、构建缓存和运行日志不会提交到仓库。

## 参与开发

当前仓库处于快速迭代期。提交改动前请确保 Python 测试、TypeScript 严格检查和生产构建全部通过，并让新增 UI 延续现有设计语言。

Slide Studio 采用 [MIT License](LICENSE) 开源。你可以使用、修改和分发代码，但需要保留原始版权与许可声明。

<div align="center">

---

<sub>Built for stories that deserve more than a script file.</sub>

<br />

<img src="https://capsule-render.vercel.app/api?type=waving&height=95&section=footer&color=0:176b5b,100:102a2a" width="100%" alt="" />

</div>
