# Hikari Studio

本地 Galgame 可视化编辑器。Python 负责桌面窗口、项目文件和本地能力，TypeScript + React 负责界面。

## 技术结构

- `backend/`：Python 桌面宿主、项目存储和 React 桥接 API
- `frontend/src/`：React + TypeScript 编辑器界面
- `frontend/dist/`：供桌面程序加载的生产构建
- `frontend/runtime-dist/`：编辑器预览、Web 和 Windows 游戏共享的 `engine-core` 运行时
- `launcher/Hikari.GameLauncher/`：基于 .NET 8 WebView2 的 Windows 游戏启动器
- `data/`：本地 v3 目录项目和迁移备份
- `tests/`：Python 项目存储测试

## 启动

```powershell
python -m pip install -r requirements.txt
cd frontend
pnpm install
pnpm build
cd ..
python run.py
```

Windows 也可以双击 `start.bat`。

## 前端开发

```powershell
cd frontend
pnpm dev
```

浏览器开发模式会使用本地缓存代替 Python API。生产构建放进 pywebview 后，项目读写会自动切换到 Python。

## 项目文件

项目使用适合 Git 的 v3 目录格式。主清单为 `project.hikari.json`，章节、片段剧本、角色和素材索引分别保存在独立 JSON 文件中。每个文件都采用临时文件原子替换，最近一次完整状态同时写入 `.hikari/recovery.json`。

```text
project.hikari.json
chapters/*.json
scripts/*.json
characters/*.json
assets/index.json
assets/files/*
locales/zh-CN.json
settings/editor.json
ui/theme.json
```

打开 v1/v2 `.hikari.json` 时会自动创建 `*.v2-backup-日期时间` 原文件备份，再迁移到同名 v3 项目目录。

## 已实现工作流

- 新建和打开 `.hikari.json` 项目
- 章节与片段的新建、切换和删除
- 每个片段保存独立的 Block 剧本
- 旁白、对白、场景、音频和选项分支 Block
- Block 编辑、复制、删除、上下移动、撤销和重做
- 角色管理和场景素材选择
- 图片、音频和视频复制到项目素材目录
- 从当前剧本实际推进的预览运行时和分支跳转
- 卡片、纯文本、Ren'Py 摘要和 JSON 视图
- 自动保存、崩溃恢复与 v1/v2 项目迁移备份
- 共享 TypeScript 预览运行时、Block 注册表和统一命令历史
- React 错误边界、前后端结构化日志和 CI 验证
- Web 游戏构建和 Ren'Py `script.rpy` 导出

构建产物写入 `exports/<项目名>/`。Web 版本的 `index.html` 可以单独部署；Windows 版本生成自包含启动器和同一套 Web 游戏运行时；Ren'Py 版本可以复制进 Ren'Py 项目的 `game` 目录继续开发。

首次构建 Windows 游戏需要 .NET 8 SDK。构建器依次查找 `HIKARI_DOTNET`、工作区 `.tools/dotnet/dotnet.exe` 和系统 `dotnet`。启动器成功编译后会缓存到 `launcher/dist/win-x64`，后续构建不再重复编译。
