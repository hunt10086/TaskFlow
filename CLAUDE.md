# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TaskFlow is a desktop task management application built with Tauri 2.0. It allows users to manage daily, weekly, monthly and yearly learning tasks with deadline tracking, completion history, and batch task creation.

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

### Capabilities
- `src-tauri/capabilities/default.json` - Tauri 2.0 plugin permissions

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
| `import_tasks_from_json` | Import tasks from JSON file |
| `export_tasks_to_json` | Export tasks to JSON file |
| `get_task_points` | Get subtasks (task points) for a task |
| `create_task_point` | Create a subtask for a task |
| `complete_task_point` | Mark a subtask as completed |
| `delete_task_point` | Delete a subtask |

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
    parent_id: Option<i64>,  // null for main tasks, task id for subtasks
}
```

### TaskPoint (Subtask)
```rust
struct TaskPoint {
    id: i64,
    task_id: i64,       // Parent task id
    title: String,
    completed: bool,
    created_at: String,
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

## JSON Import/Export

Tasks can be imported from and exported to JSON files using the file dialog.

### JSON Template Format
```json
{
  "tasks": [
    {
      "title": "任务标题",
      "task_type": "daily|weekly|monthly|yearly",
      "due_date": "2024-12-31 23:59:59"
    }
  ]
}
```

### Template File
The template file is located at: `templates/tasks_template.json`

### Settings Page
The application includes a Settings page (accessible from sidebar) that provides:
- Import template - Copy JSON template to clipboard or directly import
- Export example - Copy example JSON format
- Export current tasks - Export existing tasks to JSON file

## Task Points (Subtasks)

Task points allow breaking down a main task into smaller subtasks to track progress.

- Each task can have multiple subtasks
- Subtasks are displayed in a modal when clicking the task points button
- Progress is shown as "已完成: X / Y"

## Application Views

- **全部任务/每日任务/每周任务/每月任务** - Main task list with filters
- **过期任务** - Shows overdue uncompleted tasks
- **提交记录** - Completed task history
- **未完成任务历史** - Uncompleted task history
- **年度记录** - Annual contribution graph and statistics
- **设置** - Import/Export templates and JSON format help
