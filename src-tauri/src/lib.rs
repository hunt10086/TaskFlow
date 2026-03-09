use chrono::Local;
use rusqlite::{params, Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

// 分页参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageFilter {
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

// 带分页的结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedTasks {
    pub tasks: Vec<Task>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub total_pages: i64,
}

// 数据模型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub task_type: String, // daily, weekly, monthly
    pub created_at: String,
    pub due_date: Option<String>,
    pub completed: bool,
    pub completed_at: Option<String>,
    pub parent_id: Option<i64>, // 父任务ID，用于子任务
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewTask {
    pub title: String,
    pub task_type: String,
    pub due_date: Option<String>,
    pub parent_id: Option<i64>, // 父任务ID，用于创建子任务
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryFilter {
    pub task_type: Option<String>,
    pub completed: Option<bool>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub date_field: Option<String>, // "created_at" or "due_date" or "completed_at"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stats {
    pub total: i64,
    pub completed: i64,
    pub pending: i64,
    pub completion_rate: f64,
}

// 数据库状态
pub struct DbState(pub Mutex<Connection>);

// 初始化数据库
fn init_db(conn: &Connection) -> SqliteResult<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            task_type TEXT NOT NULL,
            created_at TEXT NOT NULL,
            due_date TEXT,
            completed INTEGER NOT NULL DEFAULT 0,
            completed_at TEXT,
            parent_id INTEGER REFERENCES tasks(id)
        )",
        [],
    )?;

    // 如果 parent_id 列不存在，则添加
    let result = conn.execute("ALTER TABLE tasks ADD COLUMN parent_id INTEGER REFERENCES tasks(id)", []);
    if let Err(e) = result {
        // 列可能已存在，忽略错误
        log::info!("parent_id column check: {:?}", e);
    }

    Ok(())
}

// 获取数据库路径
fn get_db_path() -> String {
    // 尝试多个可能的环境变量
    let candidates = ["APPDATA", "LOCALAPPDATA", "USERPROFILE"];

    for var in candidates {
        if let Ok(app_data) = std::env::var(var) {
            if !app_data.is_empty() {
                let db_dir = std::path::Path::new(&app_data).join("TaskFlow");
                if std::fs::create_dir_all(&db_dir).is_ok() {
                    return db_dir.join("tasks.db").to_string_lossy().to_string();
                }
            }
        }
    }

    // 如果都失败，使用当前目录
    "taskflow.db".to_string()
}

// Tauri 命令

// 根据任务类型计算默认截止日期
fn calculate_default_due_date(task_type: &str, custom_due_date: Option<&str>) -> Option<String> {
    // 如果用户提供了自定义截止日期，直接使用
    if let Some(due_date) = custom_due_date {
        if !due_date.is_empty() {
            return Some(due_date.to_string());
        }
    }

    // 根据任务类型计算默认截止日期
    let now = Local::now();
    let due_date = match task_type {
        "daily" => {
            // 每日任务：当天 23:59:59
            format!("{} 23:59:59", now.format("%Y-%m-%d"))
        }
        "weekly" => {
            // 每周任务：下周当天 23:59:59
            let next_week = now + chrono::Duration::days(7);
            format!("{} 23:59:59", next_week.format("%Y-%m-%d"))
        }
        "monthly" => {
            // 每月任务：30天后 23:59:59
            let next_month = now + chrono::Duration::days(30);
            format!("{} 23:59:59", next_month.format("%Y-%m-%d"))
        }
        "yearly" => {
            // 每年任务：当年12月31日 23:59:59
            let year = now.format("%Y");
            format!("{}-12-31 23:59:59", year)
        }
        _ => {
            // 默认：7天后 23:59:59
            format!("{} 23:59:59", (now + chrono::Duration::days(7)).format("%Y-%m-%d"))
        }
    };

    Some(due_date)
}

#[tauri::command]
fn create_task(state: State<DbState>, task: NewTask) -> Result<Task, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let created_at = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // 计算截止日期（如果是子任务则使用父任务的截止日期）
    let due_date = if task.parent_id.is_some() {
        // 子任务继承父任务的截止日期
        None
    } else {
        calculate_default_due_date(&task.task_type, task.due_date.as_deref())
    };

    conn.execute(
        "INSERT INTO tasks (title, task_type, created_at, due_date, completed, parent_id) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
        params![task.title, task.task_type, created_at, due_date, task.parent_id],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    Ok(Task {
        id,
        title: task.title,
        task_type: task.task_type,
        created_at,
        due_date,
        completed: false,
        completed_at: None,
        parent_id: task.parent_id,
    })
}

#[tauri::command]
fn get_tasks(state: State<DbState>, filter: Option<QueryFilter>) -> Result<Vec<Task>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    // 默认过滤掉子任务，只显示主任务
    let mut sql = "SELECT id, title, task_type, created_at, due_date, completed, completed_at, parent_id FROM tasks WHERE (parent_id IS NULL OR parent_id = 0)".to_string();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(f) = &filter {
        if let Some(ref task_type) = f.task_type {
            if !task_type.is_empty() && task_type != "all" {
                sql.push_str(" AND task_type = ?");
                params_vec.push(Box::new(task_type.clone()));
            }
        }

        if let Some(completed) = f.completed {
            sql.push_str(" AND completed = ?");
            params_vec.push(Box::new(if completed { 1 } else { 0 }));
        }

        // 时间范围查询
        if let (Some(start), Some(end)) = (&f.start_date, &f.end_date) {
            if !start.is_empty() && !end.is_empty() {
                let date_field = f.date_field.as_deref().unwrap_or("created_at");
                sql.push_str(&format!(" AND {} BETWEEN ? AND ?", date_field));
                params_vec.push(Box::new(start.clone()));
                params_vec.push(Box::new(end.clone()));
            } else if let Some(single_date) = f.start_date.as_ref().filter(|d| !d.is_empty()) {
                // 精确日期查询
                let date_field = f.date_field.as_deref().unwrap_or("created_at");
                sql.push_str(&format!(" AND date({}) = date(?)", date_field));
                params_vec.push(Box::new(single_date.clone()));
            }
        }
    }

    sql.push_str(" ORDER BY created_at DESC");

    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let tasks = stmt
        .query_map(params_refs.as_slice(), |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                task_type: row.get(2)?,
                created_at: row.get(3)?,
                due_date: row.get(4)?,
                completed: row.get::<_, i32>(5)? == 1,
                completed_at: row.get(6)?,
                parent_id: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(tasks)
}

#[tauri::command]
fn complete_task(state: State<DbState>, id: i64) -> Result<Task, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let completed_at = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    conn.execute(
        "UPDATE tasks SET completed = 1, completed_at = ?1 WHERE id = ?2",
        params![completed_at, id],
    )
    .map_err(|e| e.to_string())?;

    // 获取更新后的任务
    let mut stmt = conn
        .prepare("SELECT id, title, task_type, created_at, due_date, completed, completed_at, parent_id FROM tasks WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let task = stmt
        .query_row(params![id], |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                task_type: row.get(2)?,
                created_at: row.get(3)?,
                due_date: row.get(4)?,
                completed: row.get::<_, i32>(5)? == 1,
                completed_at: row.get(6)?,
                parent_id: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(task)
}

#[tauri::command]
fn delete_task(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn get_stats(state: State<DbState>, task_type: Option<String>) -> Result<Stats, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let mut sql = "SELECT COUNT(*), SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) FROM tasks".to_string();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(ref t) = task_type {
        if !t.is_empty() && t != "all" {
            sql.push_str(" WHERE task_type = ?");
            params_vec.push(Box::new(t.clone()));
        }
    }

    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

    let (total, completed): (i64, Option<i64>) = if params_refs.is_empty() {
        conn.query_row(&sql, [], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?
    } else {
        conn.query_row(&sql, params_refs.as_slice(), |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|e| e.to_string())?
    };

    let completed = completed.unwrap_or(0);
    let pending = total - completed;
    let completion_rate = if total > 0 {
        (completed as f64 / total as f64) * 100.0
    } else {
        0.0
    };

    Ok(Stats {
        total,
        completed,
        pending,
        completion_rate,
    })
}

#[tauri::command]
fn get_completed_history(
    state: State<DbState>,
    filter: Option<QueryFilter>,
    pagination: Option<PageFilter>,
) -> Result<PaginatedTasks, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let page = pagination.as_ref().and_then(|p| p.page).unwrap_or(1).max(1);
    let page_size = pagination.as_ref().and_then(|p| p.page_size).unwrap_or(20).max(1).min(100);
    let offset = (page - 1) * page_size;

    // 构建WHERE条件
    let mut where_clause = String::from("WHERE completed = 1");
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(f) = &filter {
        if let Some(ref task_type) = f.task_type {
            if !task_type.is_empty() && task_type != "all" {
                where_clause.push_str(" AND task_type = ?");
                params_vec.push(Box::new(task_type.clone()));
            }
        }

        // 时间范围查询
        if let (Some(start), Some(end)) = (&f.start_date, &f.end_date) {
            if !start.is_empty() && !end.is_empty() {
                let date_field = f.date_field.as_deref().unwrap_or("completed_at");
                where_clause.push_str(&format!(" AND {} BETWEEN ? AND ?", date_field));
                params_vec.push(Box::new(start.clone()));
                params_vec.push(Box::new(end.clone()));
            } else if let Some(single_date) = f.start_date.as_ref().filter(|d| !d.is_empty()) {
                let date_field = f.date_field.as_deref().unwrap_or("completed_at");
                where_clause.push_str(&format!(" AND date({}) = date(?)", date_field));
                params_vec.push(Box::new(single_date.clone()));
            }
        }
    }

    // 获取总数
    let count_sql = format!("SELECT COUNT(*) FROM tasks {}", where_clause);
    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    let total: i64 = conn
        .query_row(&count_sql, params_refs.as_slice(), |row| row.get(0))
        .map_err(|e| e.to_string())?;

    // 获取分页数据
    let sql = format!(
        "SELECT id, title, task_type, created_at, due_date, completed, completed_at, parent_id FROM tasks {} ORDER BY completed_at DESC LIMIT ? OFFSET ?",
        where_clause
    );
    // 收集原始参数的引用
    let mut params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    params_refs.push(&page_size);
    params_refs.push(&offset);

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let tasks = stmt
        .query_map(params_refs.as_slice(), |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                task_type: row.get(2)?,
                created_at: row.get(3)?,
                due_date: row.get(4)?,
                completed: row.get::<_, i32>(5)? == 1,
                completed_at: row.get(6)?,
                parent_id: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let total_pages = (total as f64 / page_size as f64).ceil() as i64;

    Ok(PaginatedTasks {
        tasks,
        total,
        page,
        page_size,
        total_pages,
    })
}

#[tauri::command]
fn get_uncompleted_history(
    state: State<DbState>,
    filter: Option<QueryFilter>,
    pagination: Option<PageFilter>,
) -> Result<PaginatedTasks, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let page = pagination.as_ref().and_then(|p| p.page).unwrap_or(1).max(1);
    let page_size = pagination.as_ref().and_then(|p| p.page_size).unwrap_or(20).max(1).min(100);
    let offset = (page - 1) * page_size;

    // 构建WHERE条件
    let mut where_clause = String::from("WHERE completed = 0");
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(f) = &filter {
        if let Some(ref task_type) = f.task_type {
            if !task_type.is_empty() && task_type != "all" {
                where_clause.push_str(" AND task_type = ?");
                params_vec.push(Box::new(task_type.clone()));
            }
        }

        // 时间范围查询 - 基于创建时间
        if let (Some(start), Some(end)) = (&f.start_date, &f.end_date) {
            if !start.is_empty() && !end.is_empty() {
                let date_field = f.date_field.as_deref().unwrap_or("created_at");
                where_clause.push_str(&format!(" AND {} BETWEEN ? AND ?", date_field));
                params_vec.push(Box::new(start.clone()));
                params_vec.push(Box::new(end.clone()));
            } else if let Some(single_date) = f.start_date.as_ref().filter(|d| !d.is_empty()) {
                let date_field = f.date_field.as_deref().unwrap_or("created_at");
                where_clause.push_str(&format!(" AND date({}) = date(?)", date_field));
                params_vec.push(Box::new(single_date.clone()));
            }
        }
    }

    // 获取总数
    let count_sql = format!("SELECT COUNT(*) FROM tasks {}", where_clause);
    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    let total: i64 = conn
        .query_row(&count_sql, params_refs.as_slice(), |row| row.get(0))
        .map_err(|e| e.to_string())?;

    // 获取分页数据
    let sql = format!(
        "SELECT id, title, task_type, created_at, due_date, completed, completed_at, parent_id FROM tasks {} ORDER BY created_at DESC LIMIT ? OFFSET ?",
        where_clause
    );
    // 收集原始参数的引用
    let mut params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    params_refs.push(&page_size);
    params_refs.push(&offset);

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let tasks = stmt
        .query_map(params_refs.as_slice(), |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                task_type: row.get(2)?,
                created_at: row.get(3)?,
                due_date: row.get(4)?,
                completed: row.get::<_, i32>(5)? == 1,
                completed_at: row.get(6)?,
                parent_id: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let total_pages = (total as f64 / page_size as f64).ceil() as i64;

    Ok(PaginatedTasks {
        tasks,
        total,
        page,
        page_size,
        total_pages,
    })
}

// 获取过期任务（已过期且未完成）
#[tauri::command]
fn get_expired_tasks(
    state: State<DbState>,
    task_type: Option<String>,
    pagination: Option<PageFilter>,
) -> Result<PaginatedTasks, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let page = pagination.as_ref().and_then(|p| p.page).unwrap_or(1).max(1);
    let page_size = pagination.as_ref().and_then(|p| p.page_size).unwrap_or(20).max(1).min(100);
    let offset = (page - 1) * page_size;

    // 构建WHERE条件
    let mut where_clause = String::from("WHERE completed = 0 AND due_date IS NOT NULL AND due_date < ?");
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    params_vec.push(Box::new(now.clone()));

    if let Some(ref t) = task_type {
        if !t.is_empty() && t != "all" {
            where_clause.push_str(" AND task_type = ?");
            params_vec.push(Box::new(t.clone()));
        }
    }

    // 获取总数
    let count_sql = format!("SELECT COUNT(*) FROM tasks {}", where_clause);
    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    let total: i64 = conn
        .query_row(&count_sql, params_refs.as_slice(), |row| row.get(0))
        .map_err(|e| e.to_string())?;

    // 获取分页数据
    let sql = format!(
        "SELECT id, title, task_type, created_at, due_date, completed, completed_at, parent_id FROM tasks {} ORDER BY due_date ASC LIMIT ? OFFSET ?",
        where_clause
    );
    // 收集原始参数的引用
    let mut params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    params_refs.push(&page_size);
    params_refs.push(&offset);

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let tasks = stmt
        .query_map(params_refs.as_slice(), |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                task_type: row.get(2)?,
                created_at: row.get(3)?,
                due_date: row.get(4)?,
                completed: row.get::<_, i32>(5)? == 1,
                completed_at: row.get(6)?,
                parent_id: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let total_pages = (total as f64 / page_size as f64).ceil() as i64;

    Ok(PaginatedTasks {
        tasks,
        total,
        page,
        page_size,
        total_pages,
    })
}

// 获取贡献数据（过去一年的每日完成任务数）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContributionDay {
    pub date: String,
    pub count: i64,
}

#[tauri::command]
fn get_contribution_data(state: State<DbState>) -> Result<Vec<ContributionDay>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    // 获取过去365天的日期
    let today = Local::now().format("%Y-%m-%d").to_string();
    let one_year_ago = (Local::now() - chrono::Duration::days(365)).format("%Y-%m-%d").to_string();

    let sql = "SELECT date(completed_at) as date, COUNT(*) as count
               FROM tasks
               WHERE completed = 1 AND completed_at IS NOT NULL
               AND date(completed_at) BETWEEN ? AND ?
               GROUP BY date(completed_at)
               ORDER BY date ASC";

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let contributions: Vec<ContributionDay> = stmt
        .query_map(params![one_year_ago, today], |row| {
            Ok(ContributionDay {
                date: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(contributions)
}

// 批量创建任务
#[tauri::command]
fn create_tasks_batch(state: State<DbState>, tasks: Vec<NewTask>) -> Result<Vec<Task>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let created_at = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let mut result_tasks: Vec<Task> = Vec::new();

    for task in tasks {
        // 计算截止日期
        let due_date = if task.parent_id.is_some() {
            None
        } else {
            calculate_default_due_date(&task.task_type, task.due_date.as_deref())
        };

        conn.execute(
            "INSERT INTO tasks (title, task_type, created_at, due_date, completed, parent_id) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
            params![task.title, task.task_type, created_at, due_date, task.parent_id],
        )
        .map_err(|e| e.to_string())?;

        let id = conn.last_insert_rowid();

        result_tasks.push(Task {
            id,
            title: task.title,
            task_type: task.task_type,
            created_at: created_at.clone(),
            due_date,
            completed: false,
            completed_at: None,
            parent_id: task.parent_id,
        });
    }

    Ok(result_tasks)
}

// JSON导入导出相关
#[derive(Debug, Serialize, Deserialize)]
pub struct JsonTask {
    pub title: String,
    #[serde(rename = "task_type")]
    pub task_type: String,
    #[serde(rename = "due_date")]
    pub due_date: Option<String>,
    #[serde(rename = "created_at", default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonTaskList {
    pub tasks: Vec<JsonTask>,
}

// 从JSON导入任务
#[tauri::command]
fn import_tasks_from_json(state: State<DbState>, json_content: String) -> Result<Vec<Task>, String> {
    let json_tasks: JsonTaskList = serde_json::from_str(&json_content)
        .map_err(|e| format!("JSON解析失败: {}", e))?;

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let created_at = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let mut result_tasks: Vec<Task> = Vec::new();

    for json_task in json_tasks.tasks {
        let due_date = calculate_default_due_date(&json_task.task_type, json_task.due_date.as_deref());

        conn.execute(
            "INSERT INTO tasks (title, task_type, created_at, due_date, completed, parent_id) VALUES (?1, ?2, ?3, ?4, 0, NULL)",
            params![json_task.title, json_task.task_type, created_at, due_date],
        )
        .map_err(|e| e.to_string())?;

        let id = conn.last_insert_rowid();

        result_tasks.push(Task {
            id,
            title: json_task.title,
            task_type: json_task.task_type,
            created_at: created_at.clone(),
            due_date,
            completed: false,
            completed_at: None,
            parent_id: None,
        });
    }

    Ok(result_tasks)
}

// 导出任务到JSON
#[tauri::command]
fn export_tasks_to_json(state: State<DbState>, include_completed: bool) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let sql = if include_completed {
        "SELECT id, title, task_type, created_at, due_date, completed, completed_at, parent_id FROM tasks ORDER BY created_at DESC"
    } else {
        "SELECT id, title, task_type, created_at, due_date, completed, completed_at, parent_id FROM tasks WHERE completed = 0 ORDER BY created_at DESC"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let tasks = stmt
        .query_map([], |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                task_type: row.get(2)?,
                created_at: row.get(3)?,
                due_date: row.get(4)?,
                completed: row.get::<_, i32>(5)? == 1,
                completed_at: row.get(6)?,
                parent_id: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let json_tasks: Vec<JsonTask> = tasks
        .iter()
        .filter(|t| t.parent_id.is_none()) // 只导出主任务
        .map(|t| JsonTask {
            title: t.title.clone(),
            task_type: t.task_type.clone(),
            due_date: t.due_date.clone(),
            created_at: Some(t.created_at.clone()),
        })
        .collect();

    let json_task_list = JsonTaskList { tasks: json_tasks };
    let json_str = serde_json::to_string_pretty(&json_task_list)
        .map_err(|e| format!("JSON序列化失败: {}", e))?;

    Ok(json_str)
}

// 导出提交记录到JSON（已完成历史 + 过期记录）
#[tauri::command]
fn export_history_to_json(state: State<DbState>) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // 获取已完成的任务和已过期的任务（不包含当前未完成且未过期的任务）
    let sql = "SELECT id, title, task_type, created_at, due_date, completed, completed_at, parent_id
               FROM tasks
               WHERE (completed = 1)
               OR (completed = 0 AND due_date IS NOT NULL AND due_date < ?)
               ORDER BY created_at DESC";

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let tasks = stmt
        .query_map(params![now], |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                task_type: row.get(2)?,
                created_at: row.get(3)?,
                due_date: row.get(4)?,
                completed: row.get::<_, i32>(5)? == 1,
                completed_at: row.get(6)?,
                parent_id: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let json_tasks: Vec<JsonTask> = tasks
        .iter()
        .filter(|t| t.parent_id.is_none()) // 只导出主任务
        .map(|t| JsonTask {
            title: t.title.clone(),
            task_type: t.task_type.clone(),
            due_date: t.due_date.clone(),
            created_at: Some(t.created_at.clone()),
        })
        .collect();

    let json_task_list = JsonTaskList { tasks: json_tasks };
    let json_str = serde_json::to_string_pretty(&json_task_list)
        .map_err(|e| format!("JSON序列化失败: {}", e))?;

    Ok(json_str)
}

// 获取任务的子任务列表
#[tauri::command]
fn get_task_points(state: State<DbState>, parent_id: i64) -> Result<Vec<Task>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, title, task_type, created_at, due_date, completed, completed_at, parent_id FROM tasks WHERE parent_id = ?1 ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;

    let tasks = stmt
        .query_map(params![parent_id], |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                task_type: row.get(2)?,
                created_at: row.get(3)?,
                due_date: row.get(4)?,
                completed: row.get::<_, i32>(5)? == 1,
                completed_at: row.get(6)?,
                parent_id: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(tasks)
}

// 创建子任务（任务点）
#[tauri::command]
fn create_task_point(state: State<DbState>, parent_id: i64, title: String) -> Result<Task, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let created_at = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // 获取父任务的task_type
    let parent_task_type: String = conn
        .query_row(
            "SELECT task_type FROM tasks WHERE id = ?1",
            params![parent_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    // 子任务继承父任务的截止日期
    let due_date: Option<String> = conn
        .query_row(
            "SELECT due_date FROM tasks WHERE id = ?1",
            params![parent_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO tasks (title, task_type, created_at, due_date, completed, parent_id) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
        params![title, parent_task_type, created_at, due_date, parent_id],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    Ok(Task {
        id,
        title,
        task_type: parent_task_type,
        created_at,
        due_date,
        completed: false,
        completed_at: None,
        parent_id: Some(parent_id),
    })
}

// 完成任务点
#[tauri::command]
fn complete_task_point(state: State<DbState>, id: i64) -> Result<Task, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let completed_at = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    conn.execute(
        "UPDATE tasks SET completed = 1, completed_at = ?1 WHERE id = ?2",
        params![completed_at, id],
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, title, task_type, created_at, due_date, completed, completed_at, parent_id FROM tasks WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let task = stmt
        .query_row(params![id], |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                task_type: row.get(2)?,
                created_at: row.get(3)?,
                due_date: row.get(4)?,
                completed: row.get::<_, i32>(5)? == 1,
                completed_at: row.get(6)?,
                parent_id: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(task)
}

// 删除任务点
#[tauri::command]
fn delete_task_point(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

// 获取任务点统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskPointStats {
    pub total: i64,
    pub completed: i64,
    pub pending: i64,
}

// 获取任务点的完成统计
#[tauri::command]
fn get_task_point_stats(state: State<DbState>, parent_id: i64) -> Result<TaskPointStats, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let (total, completed): (i64, Option<i64>) = conn
        .query_row(
            "SELECT COUNT(*), SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) FROM tasks WHERE parent_id = ?1",
            params![parent_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let completed = completed.unwrap_or(0);
    let pending = total - completed;

    Ok(TaskPointStats {
        total,
        completed,
        pending,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化日志
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    log::info!("TaskFlow 应用启动中...");

    // 获取数据库路径
    let db_path = get_db_path();
    log::info!("数据库路径: {}", db_path);

    // 确保目录存在
    if let Some(parent) = std::path::Path::new(&db_path).parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            log::error!("无法创建数据库目录: {}", e);
        }
    }

    // 初始化数据库
    let conn = match Connection::open(&db_path) {
        Ok(c) => c,
        Err(e) => {
            log::error!("无法打开数据库: {}", e);
            // 尝试在当前目录创建
            let fallback_path = "taskflow.db";
            log::info!("尝试使用备用路径: {}", fallback_path);
            Connection::open(fallback_path).expect("无法打开数据库（备用路径也失败）")
        }
    };

    init_db(&conn).expect("无法初始化数据库");

    log::info!("数据库初始化完成");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(DbState(Mutex::new(conn)))
        .invoke_handler(tauri::generate_handler![
            create_task,
            get_tasks,
            complete_task,
            delete_task,
            get_stats,
            get_completed_history,
            get_uncompleted_history,
            get_expired_tasks,
            create_tasks_batch,
            get_contribution_data,
            import_tasks_from_json,
            export_tasks_to_json,
            export_history_to_json,
            get_task_points,
            create_task_point,
            complete_task_point,
            delete_task_point,
            get_task_point_stats,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用时出错");
}
