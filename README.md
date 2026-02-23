
<img width="2559" height="1439" alt="Screenshot 2026-02-23 224734" src="https://github.com/user-attachments/assets/b7dc4dc4-c081-42e3-a216-c20bcca336a1" />

# TaskFlow 任务进度管理器

TaskFlow 是一个基于 Tauri 2.0 构建的桌面任务管理应用，帮助用户管理每日、每周、每月的学习任务，支持截止日期追踪、完成历史记录和批量任务创建。

## 功能特性

- **任务类型管理**：支持每日、每周、每月、年度任务
- **截止日期追踪**：自动计算默认截止日期，清晰显示逾期任务
- **批量创建**：支持一次性创建多个任务
- **完成历史**：记录任务完成历史，可查看已完成和未完成任务
- **数据统计**：查看任务统计数据，了解任务完成情况
- **分页显示**：任务列表支持分页浏览

## 技术栈

- **前端**：TypeScript + Vite
- **后端**：Rust + Tauri 2.0
- **数据库**：SQLite (rusqlite)

## 快速开始

### 前置要求

- Node.js 18+
- Rust 工具链 (rustup)
- npm 或 pnpm

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
# 运行前端开发服务器
npm run dev

# 运行 Tauri 开发模式（需要 Rust 工具链）
npm run tauri dev
```

### 构建发布

```bash
# 构建前端
npm run build

# 构建 Tauri 应用
npm run tauri build
```

## 项目结构

```
├── index.html          # HTML 入口
├── src/
│   ├── main.ts         # 前端逻辑
│   └── styles.css      # 样式文件
├── src-tauri/
│   ├── src/
│   │   └── lib.rs     # Tauri 命令和数据库操作
│   ├── Cargo.toml     # Rust 依赖
│   └── tauri.conf.json # Tauri 配置
└── README.md
```

## 数据存储

SQLite 数据库存储位置：`%APPDATA%/TaskFlow/tasks.db`

## 许可证

MIT
