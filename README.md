<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&height=190&color=0:102a2a,45:176b5b,100:e56b4f&text=Hikari%20Studio&fontColor=ffffff&fontSize=52&fontAlignY=36&desc=AI%20Native%20Visual%20Novel%20Studio&descAlignY=58&animation=fadeIn" width="100%" alt="Hikari Studio" />

<a href="https://github.com/kylemarvin884/Hikari-Studio/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/kylemarvin884/Hikari-Studio/ci.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=white&label=Build" alt="Build status" /></a>
<img src="https://img.shields.io/badge/Platform-Windows-16706a?style=for-the-badge&logo=windows11&logoColor=white" alt="Windows" />
<img src="https://img.shields.io/badge/Python-3.12-e56b4f?style=for-the-badge&logo=python&logoColor=white" alt="Python 3.12" />
<img src="https://img.shields.io/badge/React-19-202b33?style=for-the-badge&logo=react&logoColor=61dafb" alt="React 19" />
<img src="https://img.shields.io/badge/TypeScript-Strict-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript Strict" />

<br /><br />

<a href="https://git.io/typing-svg"><img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=600&size=20&pause=1100&color=176B5B&center=true&vCenter=true&width=760&lines=%E7%94%A8+Block+%E5%86%99%E4%B8%8B%E6%95%85%E4%BA%8B%EF%BC%8C%E7%94%A8%E5%8F%AF%E8%A7%86%E5%8C%96%E6%BC%94%E5%87%BA%E8%AE%A9%E5%AE%83%E5%8F%91%E7%94%9F;Python+Desktop+Host+%C2%B7+React+Editor+%C2%B7+Shared+TypeScript+Runtime;Make+visual+novels+feel+simple%2C+without+making+the+engine+simple" alt="Hikari Studio typing introduction" /></a>

**面向创作者的本地 Galgame 可视化编辑器。** 让剧本、演出、素材、调试与构建留在同一个安静、完整的制作环境中。

[功能概览](#-功能概览) · [快速开始](#-快速开始) · [技术架构](#-技术架构) · [开发进度](#-开发进度)

</div>

> [!IMPORTANT]
> Hikari Studio 仍处于积极开发阶段，当前仓库是可运行的工程预览版，不代表稳定发行版。项目格式会提供迁移能力，但公开 API 仍可能调整。

## 编辑器预览

<p align="center">
  <img src="docs/images/editor-overview.png" width="100%" alt="Hikari Studio 剧本编辑、实时预览与属性检查器" />
</p>

<div align="center"><sub>剧本 Block 编辑 · 游戏实时预览 · OP 定位 · 属性检查器</sub></div>

## 功能概览

| 工作区 | 当前能力 |
| --- | --- |
| **剧本编辑** | 对白、旁白、场景、声音、角色演出、变量、条件、分支、跳转与 Fragment 调用 |
| **四种视图** | 卡片编辑、纯文本、Ren'Py 风格摘要、底层 JSON OP |
| **角色与场景** | 每个表情独立立绘、多层场景、视差距离、图层偏移、立绘拖拽与吸附辅助线 |
| **资源管线** | 图片、音频、视频、字体管理，引用分析、缺失诊断、强制打包与文件夹批量修复 |
| **叙事地图** | 可移动流程节点、章节与 Fragment 关系、变量因果追踪、分支连线 |
| **实时调试** | 编辑器与 OP 双向定位、变量观察、调用栈、Console、快速存档与流程回滚 |
| **游戏运行时** | 打字机文本、自动播放、快进、历史、存读档、音量与文本速度设置 |
| **主题系统** | 对白字体、颜色、渐变高度、姓名样式、系统菜单和存档界面实时预览 |
| **构建发布** | Web 游戏、Windows WebView2 启动器与 Ren'Py 导出 |
| **AI Agent** | Provider 配置与结构化任务界面；全局制作 Agent 正在持续实现 |

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
    Editor <--> Bridge["pywebview Desktop API"]
    Bridge <--> Host["Python 桌面宿主"]
    Host --> FS["v3 目录项目 / 文件系统"]
    Host --> Build["构建 / Git / AI / 系统能力"]
    Editor --> Core["engine-core"]
    Core --> Preview["编辑器实时预览"]
    Core --> Web["Web 游戏"]
    Core --> Win["Windows WebView2 游戏"]
```

编辑器预览、Web 游戏和 Windows 游戏共享同一套 TypeScript `engine-core`，避免三套运行逻辑逐渐产生行为差异。

| 目录 | 职责 |
| --- | --- |
| `backend/` | Python 桌面宿主、项目存储、桌面 API、导入与构建能力 |
| `frontend/src/` | React + TypeScript 编辑器界面 |
| `frontend/src/engine-core/` | Block 注册、运行状态、诊断和共享执行逻辑 |
| `frontend/src/runtime/` | 导出游戏使用的玩家运行时 |
| `launcher/Hikari.GameLauncher/` | 基于 .NET 8 WebView2 的 Windows 游戏启动器 |
| `data/star-sea-echo/` | v3 格式示例项目 |
| `tests/` | Python 项目存储、API、导入、导出和构建测试 |

## 快速开始

### 环境要求

- Windows 10/11
- Python 3.12+
- Node.js 22+ 与 pnpm 10+
- .NET 8 SDK，仅在构建 Windows 游戏时需要

### 运行桌面编辑器

```powershell
git clone https://github.com/kylemarvin884/Hikari-Studio.git
cd Hikari-Studio

python -m pip install -r requirements.txt
cd frontend
pnpm install --frozen-lockfile
pnpm build
cd ..

python run.py
```

Windows 用户也可以在依赖安装完成后运行 `start.bat`。

### 前端开发模式

```powershell
cd frontend
pnpm dev
```

浏览器开发模式使用本地缓存模拟项目存储；通过 `python run.py` 启动时，文件系统与系统能力会自动切换到 Python Desktop API。

## 项目格式

Hikari v3 使用适合 Git diff 与团队协作的目录结构：

```text
project.hikari.json
chapters/*.json
scripts/*.json
characters/*.json
scenes/*.json
assets/index.json
assets/files/*
locales/zh-CN.json
settings/editor.json
ui/theme.json
```

打开 v1/v2 项目时会先生成带时间戳的备份，再迁移到 v3。项目写入采用临时文件原子替换，并维护本地崩溃恢复副本。

## 开发进度

```text
工程基础与 v3 项目格式   ██████████  完成
核心运行时与编辑器接线   ████████░░  持续完善
舞台与演出工具           ██████░░░░  开发中
生产级资源管线           ███████░░░  开发中
全局 AI 制作 Agent       ███░░░░░░░  开发中
Windows / Web 发布       ██████░░░░  可用，待稳定化
```

接下来的重点：

1. 完成全局 AI Agent 的工具注册表、结构化差异确认和全分支模拟。
2. 补齐所有 Block 的运行时行为、诊断和 SaveGame 迁移测试。
3. 提升大型项目搜索、叙事地图布局和素材扫描性能。
4. 完善 Windows 安装包、自动升级与 Beta 回归流程。

完整阶段规划见 [`docs/phase-2-roadmap.md`](docs/phase-2-roadmap.md)。

## 验证

```powershell
python -m unittest discover -s tests -q

cd frontend
pnpm test
pnpm run typecheck
pnpm run build
```

每次推送和 Pull Request 都会在 Windows runner 上执行 Python 测试、TypeScript 检查、两套前端构建和 .NET 启动器发布验证。

## 安全约定

- AI API Key 不写入项目、日志、崩溃报告或游戏构建包。
- Agent 的写入操作必须先展示结构化修改并由用户确认。
- 删除、覆盖和发布构建使用单独确认级别。
- 本地恢复文件、编辑器设置、构建缓存和运行日志不会提交到仓库。

## 参与开发

当前仓库处于快速迭代期。提交改动前请确保 Python 测试、TypeScript 严格检查和生产构建全部通过，并让新增 UI 延续现有设计语言。

<div align="center">

---

<sub>Built for stories that deserve more than a script file.</sub>

<br />

<img src="https://capsule-render.vercel.app/api?type=waving&height=95&section=footer&color=0:176b5b,100:102a2a" width="100%" alt="" />

</div>
