use chrono::Utc;
use rusqlite::{params, Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewTask {
    pub title: String,
    pub task_type: String,
    pub due_date: Option<String>,
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
            completed_at TEXT
        )",
        [],
    )?;
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

#[tauri::command]
fn create_task(state: State<DbState>, task: NewTask) -> Result<Task, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let created_at = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    conn.execute(
        "INSERT INTO tasks (title, task_type, created_at, due_date, completed) VALUES (?1, ?2, ?3, ?4, 0)",
        params![task.title, task.task_type, created_at, task.due_date],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    Ok(Task {
        id,
        title: task.title,
        task_type: task.task_type,
        created_at,
        due_date: task.due_date,
        completed: false,
        completed_at: None,
    })
}

#[tauri::command]
fn get_tasks(state: State<DbState>, filter: Option<QueryFilter>) -> Result<Vec<Task>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let mut sql = "SELECT id, title, task_type, created_at, due_date, completed, completed_at FROM tasks WHERE 1=1".to_string();
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
    let completed_at = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    conn.execute(
        "UPDATE tasks SET completed = 1, completed_at = ?1 WHERE id = ?2",
        params![completed_at, id],
    )
    .map_err(|e| e.to_string())?;

    // 获取更新后的任务
    let mut stmt = conn
        .prepare("SELECT id, title, task_type, created_at, due_date, completed, completed_at FROM tasks WHERE id = ?1")
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
) -> Result<Vec<Task>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let mut sql =
        "SELECT id, title, task_type, created_at, due_date, completed, completed_at FROM tasks WHERE completed = 1"
            .to_string();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(f) = &filter {
        if let Some(ref task_type) = f.task_type {
            if !task_type.is_empty() && task_type != "all" {
                sql.push_str(" AND task_type = ?");
                params_vec.push(Box::new(task_type.clone()));
            }
        }

        // 时间范围查询
        if let (Some(start), Some(end)) = (&f.start_date, &f.end_date) {
            if !start.is_empty() && !end.is_empty() {
                let date_field = f.date_field.as_deref().unwrap_or("completed_at");
                sql.push_str(&format!(" AND {} BETWEEN ? AND ?", date_field));
                params_vec.push(Box::new(start.clone()));
                params_vec.push(Box::new(end.clone()));
            } else if let Some(single_date) = f.start_date.as_ref().filter(|d| !d.is_empty()) {
                let date_field = f.date_field.as_deref().unwrap_or("completed_at");
                sql.push_str(&format!(" AND date({}) = date(?)", date_field));
                params_vec.push(Box::new(single_date.clone()));
            }
        }
    }

    sql.push_str(" ORDER BY completed_at DESC");

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
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(tasks)
}

#[tauri::command]
fn get_uncompleted_history(
    state: State<DbState>,
    filter: Option<QueryFilter>,
) -> Result<Vec<Task>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let mut sql =
        "SELECT id, title, task_type, created_at, due_date, completed, completed_at FROM tasks WHERE completed = 0"
            .to_string();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(f) = &filter {
        if let Some(ref task_type) = f.task_type {
            if !task_type.is_empty() && task_type != "all" {
                sql.push_str(" AND task_type = ?");
                params_vec.push(Box::new(task_type.clone()));
            }
        }

        // 时间范围查询 - 基于创建时间
        if let (Some(start), Some(end)) = (&f.start_date, &f.end_date) {
            if !start.is_empty() && !end.is_empty() {
                let date_field = f.date_field.as_deref().unwrap_or("created_at");
                sql.push_str(&format!(" AND {} BETWEEN ? AND ?", date_field));
                params_vec.push(Box::new(start.clone()));
                params_vec.push(Box::new(end.clone()));
            } else if let Some(single_date) = f.start_date.as_ref().filter(|d| !d.is_empty()) {
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
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(tasks)
}

// 获取过期任务（已过期且未完成）
#[tauri::command]
fn get_expired_tasks(state: State<DbState>, task_type: Option<String>) -> Result<Vec<Task>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let today = Utc::now().format("%Y-%m-%d").to_string();

    let mut sql = "SELECT id, title, task_type, created_at, due_date, completed, completed_at FROM tasks WHERE completed = 0 AND due_date IS NOT NULL AND due_date < ?"
        .to_string();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    params_vec.push(Box::new(today.clone()));

    if let Some(ref t) = task_type {
        if !t.is_empty() && t != "all" {
            sql.push_str(" AND task_type = ?");
            params_vec.push(Box::new(t.clone()));
        }
    }

    sql.push_str(" ORDER BY due_date ASC");

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
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(tasks)
}

// 批量创建任务
#[tauri::command]
fn create_tasks_batch(state: State<DbState>, tasks: Vec<NewTask>) -> Result<Vec<Task>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let created_at = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let mut result_tasks: Vec<Task> = Vec::new();

    for task in tasks {
        conn.execute(
            "INSERT INTO tasks (title, task_type, created_at, due_date, completed) VALUES (?1, ?2, ?3, ?4, 0)",
            params![task.title, task.task_type, created_at, task.due_date],
        )
        .map_err(|e| e.to_string())?;

        let id = conn.last_insert_rowid();

        result_tasks.push(Task {
            id,
            title: task.title,
            task_type: task.task_type,
            created_at: created_at.clone(),
            due_date: task.due_date,
            completed: false,
            completed_at: None,
        });
    }

    Ok(result_tasks)
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
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用时出错");
}
