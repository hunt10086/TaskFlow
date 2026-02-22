# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TaskFlow is a desktop task management application built with Tauri 2.0. It allows users to manage daily, weekly, and monthly learning tasks with deadline tracking, completion history, and batch task creation.

## Commands

```bash
# Development
npm run dev              # Run Vite dev server
npm run tauri dev        # Run Tauri in development mode (requires Rust toolchain)

# Build
npm run tauri build      # Build production executable
npm run build            # Build frontend only (tsc && vite build)
```

## Architecture

### Frontend (TypeScript + Vite)
- `index.html` - Main HTML entry point
- `src/main.ts` - Frontend logic with Tauri invoke calls
- `src/styles.css` - CSS styling with CSS variables

### Backend (Rust + Tauri)
- `src-tauri/src/lib.rs` - All Tauri commands and database operations
- `src-tauri/Cargo.toml` - Rust dependencies
- `src-tauri/tauri.conf.json` - Tauri configuration

### Database
- SQLite file stored at: `%APPDATA%/TaskFlow/tasks.db`
- Uses rusqlite crate with bundled SQLite

## Tauri Commands (in lib.rs)

| Command | Description |
|---------|-------------|
| `create_task` | Create a single task |
| `create_tasks_batch` | Create multiple tasks at once |
| `get_tasks` | Get incomplete tasks with optional filters and pagination |
| `complete_task` | Mark a task as completed |
| `delete_task` | Delete a task |
| `get_stats` | Get task statistics |
| `get_completed_history` | Get completed task history |
| `get_uncompleted_history` | Get uncompleted task history |
| `get_expired_tasks` | Get overdue tasks |

## Default Due Date Logic

The default due date is calculated based on task type:

| Task Type | Default Due Date |
|-----------|------------------|
| daily | Today 23:59:59 |
| weekly | 7 days later 23:59:59 |
| monthly | 30 days later 23:59:59 |
| yearly | 365 days later 23:59:59 |

## Data Models

### Task
```rust
struct Task {
    id: i64,
    title: String,
    task_type: String,  // daily, weekly, monthly, yearly
    created_at: String,
    due_date: Option<String>,
    completed: bool,
    completed_at: Option<String>,
}
```

### QueryFilter
```rust
struct QueryFilter {
    task_type: Option<String>,
    completed: Option<bool>,
    start_date: Option<String>,
    end_date: Option<String>,
    date_field: Option<String>,
    page: Option<i64>,
    page_size: Option<i64>,
}
```

### PageFilter
```rust
struct PageFilter {
    page: Option<i64>,
    page_size: Option<i64>,
}
```

### PaginatedTasks
```rust
struct PaginatedTasks {
    tasks: Vec<Task>,
    total: i64,
    page: i64,
    page_size: i64,
    total_pages: i64,
}
```

## Frontend-Backend Communication

Frontend calls Tauri commands using `@tauri-apps/api/core`:

```typescript
import { invoke } from "@tauri-apps/api/core";

await invoke("create_task", { task: { title, task_type, due_date } });
await invoke("get_tasks", { filter: { task_type: "daily", completed: false } });
```
