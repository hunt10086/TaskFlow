import { invoke } from "@tauri-apps/api/core";

// 类型定义
interface Task {
  id: number;
  title: string;
  task_type: string;
  created_at: string;
  due_date: string | null;
  completed: boolean;
  completed_at: string | null;
}

interface NewTask {
  title: string;
  task_type: string;
  due_date: string | null;
}

interface QueryFilter {
  task_type?: string;
  completed?: boolean;
  start_date?: string;
  end_date?: string;
  date_field?: string;
}

interface Stats {
  total: number;
  completed: number;
  pending: number;
  completion_rate: number;
}

// 状态
let currentView: "tasks" | "history" | "expired" = "tasks";
let currentTaskType: string = "all";
let historyType: "completed" | "uncompleted" = "completed";

// DOM 元素
const elements = {
  // 视图
  viewTasks: document.getElementById("view-tasks") as HTMLDivElement,
  viewHistory: document.getElementById("view-history") as HTMLDivElement,
  viewExpired: document.getElementById("view-expired") as HTMLDivElement,
  taskList: document.getElementById("task-list") as HTMLDivElement,
  historyList: document.getElementById("history-list") as HTMLDivElement,
  expiredList: document.getElementById("expired-list") as HTMLDivElement,
  emptyTasks: document.getElementById("empty-tasks") as HTMLDivElement,
  emptyHistory: document.getElementById("empty-history") as HTMLDivElement,
  emptyExpired: document.getElementById("empty-expired") as HTMLDivElement,

  // 标题
  pageTitle: document.getElementById("page-title") as HTMLHeadingElement,

  // 导航
  navItems: document.querySelectorAll(".nav-item") as NodeListOf<HTMLButtonElement>,

  // 模态框
  modalNewTask: document.getElementById("modal-new-task") as HTMLDivElement,
  modalClose: document.getElementById("modal-close") as HTMLButtonElement,
  btnAddTask: document.getElementById("btn-add-task") as HTMLButtonElement,
  btnCancel: document.getElementById("btn-cancel") as HTMLButtonElement,
  formNewTask: document.getElementById("form-new-task") as HTMLFormElement,
  taskTitle: document.getElementById("task-title") as HTMLInputElement,
  taskDueDate: document.getElementById("task-due-date") as HTMLInputElement,

  // 批量创建模态框
  modalBatchTask: document.getElementById("modal-batch-task") as HTMLDivElement,
  modalBatchClose: document.getElementById("modal-batch-close") as HTMLButtonElement,
  btnBatchTask: document.getElementById("btn-batch-task") as HTMLButtonElement,
  btnBatchCancel: document.getElementById("btn-batch-cancel") as HTMLButtonElement,
  formBatchTask: document.getElementById("form-batch-task") as HTMLFormElement,
  batchTasks: document.getElementById("batch-tasks") as HTMLTextAreaElement,
  batchDueDate: document.getElementById("batch-due-date") as HTMLInputElement,

  // 统计
  statTotal: document.getElementById("stat-total") as HTMLSpanElement,
  statCompleted: document.getElementById("stat-completed") as HTMLSpanElement,
  statPending: document.getElementById("stat-pending") as HTMLSpanElement,
  statRate: document.getElementById("stat-rate") as HTMLSpanElement,

  // 过期任务数量
  expiredCount: document.getElementById("expired-count") as HTMLSpanElement,

  // 查询面板
  queryDateField: document.getElementById("query-date-field") as HTMLSelectElement,
  queryTaskType: document.getElementById("query-task-type") as HTMLSelectElement,
  queryStartDate: document.getElementById("query-start-date") as HTMLInputElement,
  queryEndDate: document.getElementById("query-end-date") as HTMLInputElement,
  btnQuery: document.getElementById("btn-query") as HTMLButtonElement,
};

// 初始化
async function init() {
  setupEventListeners();
  await loadStats();
  await loadTasks();
  await loadExpiredTasks(); // 加载过期任务数量
}

// 事件监听
function setupEventListeners() {
  // 导航点击
  elements.navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const view = item.dataset.view as "tasks" | "history" | "expired";
      const type = item.dataset.type as string;

      elements.navItems.forEach((nav) => nav.classList.remove("active"));
      item.classList.add("active");

      if (view === "tasks") {
        currentView = "tasks";
        currentTaskType = type;
        showTasksView(type);
      } else if (view === "expired") {
        currentView = "expired";
        showExpiredView();
      } else {
        currentView = "history";
        historyType = type as "completed" | "uncompleted";
        showHistoryView(type);
      }
    });
  });

  // 新建任务按钮
  elements.btnAddTask.addEventListener("click", () => {
    elements.modalNewTask.classList.add("active");
    elements.taskTitle.focus();
  });

  // 批量创建任务按钮
  elements.btnBatchTask.addEventListener("click", () => {
    elements.modalBatchTask.classList.add("active");
    elements.batchTasks.focus();
  });

  // 关闭模态框
  elements.modalClose.addEventListener("click", closeModal);
  elements.btnCancel.addEventListener("click", closeModal);
  elements.modalNewTask.querySelector(".modal-backdrop")?.addEventListener("click", closeModal);

  // 关闭批量创建模态框
  elements.modalBatchClose.addEventListener("click", closeBatchModal);
  elements.btnBatchCancel.addEventListener("click", closeBatchModal);
  elements.modalBatchTask.querySelector(".modal-backdrop")?.addEventListener("click", closeBatchModal);

  // 提交新任务
  elements.formNewTask.addEventListener("submit", async (e) => {
    e.preventDefault();
    await createTask();
  });

  // 提交批量任务
  elements.formBatchTask.addEventListener("submit", async (e) => {
    e.preventDefault();
    await createTasksBatch();
  });

  // 查询按钮
  elements.btnQuery.addEventListener("click", () => {
    loadHistory();
  });
}

// 显示任务视图
async function showTasksView(type: string) {
  elements.viewTasks.style.display = "block";
  elements.viewHistory.style.display = "none";
  elements.viewExpired.style.display = "none";

  // 更新标题
  const titles: Record<string, string> = {
    all: "全部任务",
    daily: "每日任务",
    weekly: "每周任务",
    monthly: "每月任务",
  };
  elements.pageTitle.textContent = titles[type] || "全部任务";

  // 显示新建任务按钮
  elements.btnAddTask.style.display = "flex";

  // 加载任务
  currentTaskType = type;
  await loadTasks();
}

// 显示历史视图
async function showHistoryView(type: string) {
  elements.viewTasks.style.display = "none";
  elements.viewHistory.style.display = "block";
  elements.viewExpired.style.display = "none";

  // 更新标题
  const titles: Record<string, string> = {
    completed: "提交记录",
    uncompleted: "未完成任务",
  };
  elements.pageTitle.textContent = titles[type] || "历史记录";

  // 隐藏新建任务按钮
  elements.btnAddTask.style.display = "none";

  // 加载历史记录
  historyType = type as "completed" | "uncompleted";
  await loadHistory();
}

// 显示过期任务视图
async function showExpiredView() {
  elements.viewTasks.style.display = "none";
  elements.viewHistory.style.display = "none";
  elements.viewExpired.style.display = "block";

  // 更新标题
  elements.pageTitle.textContent = "过期任务";

  // 隐藏新建任务按钮
  elements.btnAddTask.style.display = "none";

  // 加载过期任务
  await loadExpiredTasks();
}

// 关闭模态框
function closeModal() {
  elements.modalNewTask.classList.remove("active");
  elements.formNewTask.reset();
}

// 关闭批量创建模态框
function closeBatchModal() {
  elements.modalBatchTask.classList.remove("active");
  elements.formBatchTask.reset();
}

// 加载任务
async function loadTasks() {
  try {
    const filter: QueryFilter = {
      task_type: currentTaskType,
      completed: false,
    };

    const tasks = await invoke<Task[]>("get_tasks", { filter });
    renderTasks(tasks);
  } catch (error) {
    console.error("加载任务失败:", error);
  }
}

// 加载过期任务
async function loadExpiredTasks() {
  try {
    const tasks = await invoke<Task[]>("get_expired_tasks", {
      taskType: currentTaskType !== "all" ? currentTaskType : null,
    });
    renderExpiredTasks(tasks);
    updateExpiredCount(tasks.length);
  } catch (error) {
    console.error("加载过期任务失败:", error);
  }
}

// 更新过期任务数量
function updateExpiredCount(count: number) {
  if (count > 0) {
    elements.expiredCount.textContent = count.toString();
    elements.expiredCount.style.display = "inline-flex";
  } else {
    elements.expiredCount.style.display = "none";
  }
}

// 渲染过期任务列表
function renderExpiredTasks(tasks: Task[]) {
  if (tasks.length === 0) {
    elements.expiredList.innerHTML = "";
    elements.emptyExpired.style.display = "flex";
    return;
  }

  elements.emptyExpired.style.display = "none";
  elements.expiredList.innerHTML = tasks
    .map(
      (task) => `
    <div class="task-card expired" data-id="${task.id}">
      <label class="task-checkbox">
        <input type="checkbox" onchange="completeTask(${task.id})">
        <span class="checkbox-custom"></span>
      </label>
      <div class="task-content">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-meta">
          <span class="task-type-badge ${task.task_type}">${getTypeName(task.task_type)}</span>
          <span>创建于 ${formatDate(task.created_at)}</span>
          ${task.due_date ? `<span class="due-date-expired">已过期: ${formatDate(task.due_date)}</span>` : ""}
        </div>
      </div>
      <div class="task-actions">
        <button class="btn-action btn-delete" onclick="deleteTask(${task.id})" title="删除">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            <line x1="10" y1="11" x2="10" y2="17"/>
            <line x1="14" y1="11" x2="14" y2="17"/>
          </svg>
        </button>
      </div>
    </div>
  `
    )
    .join("");
}

// 渲染任务列表
function renderTasks(tasks: Task[]) {
  if (tasks.length === 0) {
    elements.taskList.innerHTML = "";
    elements.emptyTasks.style.display = "flex";
    return;
  }

  elements.emptyTasks.style.display = "none";
  elements.taskList.innerHTML = tasks
    .map(
      (task) => `
    <div class="task-card ${task.completed ? "completed" : ""}" data-id="${task.id}">
      <label class="task-checkbox">
        <input type="checkbox" ${task.completed ? "checked" : ""} onchange="completeTask(${task.id})">
        <span class="checkbox-custom"></span>
      </label>
      <div class="task-content">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-meta">
          <span class="task-type-badge ${task.task_type}">${getTypeName(task.task_type)}</span>
          <span>创建于 ${formatDate(task.created_at)}</span>
          ${task.due_date ? `<span>截止 ${formatDate(task.due_date)}</span>` : ""}
        </div>
      </div>
      <div class="task-actions">
        <button class="btn-action btn-delete" onclick="deleteTask(${task.id})" title="删除">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            <line x1="10" y1="11" x2="10" y2="17"/>
            <line x1="14" y1="11" x2="14" y2="17"/>
          </svg>
        </button>
      </div>
    </div>
  `
    )
    .join("");
}

// 加载历史记录
async function loadHistory() {
  try {
    const filter: QueryFilter = {
      task_type: elements.queryTaskType.value !== "all" ? elements.queryTaskType.value : undefined,
      start_date: elements.queryStartDate.value || undefined,
      end_date: elements.queryEndDate.value || undefined,
      date_field: elements.queryDateField.value,
    };

    let tasks: Task[];

    if (historyType === "completed") {
      tasks = await invoke<Task[]>("get_completed_history", { filter });
    } else {
      tasks = await invoke<Task[]>("get_uncompleted_history", { filter });
    }

    renderHistory(tasks);
  } catch (error) {
    console.error("加载历史记录失败:", error);
  }
}

// 渲染历史记录
function renderHistory(tasks: Task[]) {
  if (tasks.length === 0) {
    elements.historyList.innerHTML = "";
    elements.emptyHistory.style.display = "flex";
    return;
  }

  elements.emptyHistory.style.display = "none";
  elements.historyList.innerHTML = tasks
    .map(
      (task) => `
    <div class="task-card ${task.completed ? "completed" : ""}" data-id="${task.id}">
      <label class="task-checkbox">
        <input type="checkbox" ${task.completed ? "checked" : ""} ${task.completed ? "disabled" : ""} onchange="completeTask(${task.id})">
        <span class="checkbox-custom"></span>
      </label>
      <div class="task-content">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-meta">
          <span class="task-type-badge ${task.task_type}">${getTypeName(task.task_type)}</span>
          <span>创建于 ${formatDate(task.created_at)}</span>
          ${task.completed_at ? `<span>完成于 ${formatDate(task.completed_at)}</span>` : ""}
        </div>
      </div>
      <div class="task-actions">
        <button class="btn-action btn-delete" onclick="deleteTask(${task.id})" title="删除">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            <line x1="10" y1="11" x2="10" y2="17"/>
            <line x1="14" y1="11" x2="14" y2="17"/>
          </svg>
        </button>
      </div>
    </div>
  `
    )
    .join("");
}

// 创建任务
async function createTask() {
  const title = elements.taskTitle.value.trim();
  if (!title) return;

  const taskTypeInput = document.querySelector('input[name="task-type"]:checked') as HTMLInputElement;
  const taskType = taskTypeInput?.value || "daily";
  const dueDate = elements.taskDueDate.value || null;

  try {
    const newTask: NewTask = {
      title,
      task_type: taskType,
      due_date: dueDate,
    };

    await invoke("create_task", { task: newTask });

    closeModal();
    await loadTasks();
    await loadStats();
    await loadExpiredTasks(); // 更新过期任务数量
  } catch (error) {
    console.error("创建任务失败:", error);
  }
}

// 批量创建任务
async function createTasksBatch() {
  const batchText = elements.batchTasks.value.trim();
  if (!batchText) return;

  const taskTypeInput = document.querySelector('input[name="batch-task-type"]:checked') as HTMLInputElement;
  const taskType = taskTypeInput?.value || "daily";
  const dueDate = elements.batchDueDate.value || null;

  // 按行分割任务标题
  const titles = batchText
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (titles.length === 0) return;

  try {
    const tasks: NewTask[] = titles.map((title) => ({
      title,
      task_type: taskType,
      due_date: dueDate,
    }));

    await invoke("create_tasks_batch", { tasks });

    closeBatchModal();
    await loadTasks();
    await loadStats();
    await loadExpiredTasks(); // 更新过期任务数量
  } catch (error) {
    console.error("批量创建任务失败:", error);
  }
}

// 完成任务
async function completeTask(id: number) {
  try {
    await invoke("complete_task", { id });
    await loadTasks();
    await loadStats();
    await loadExpiredTasks(); // 更新过期任务数量

    // 如果在历史视图，也刷新历史
    if (currentView === "history") {
      await loadHistory();
    }

    // 如果在过期任务视图，也刷新
    if (currentView === "expired") {
      await loadExpiredTasks();
    }
  } catch (error) {
    console.error("完成任务失败:", error);
  }
}

// 删除任务
async function deleteTask(id: number) {
  try {
    await invoke("delete_task", { id });
    await loadTasks();
    await loadStats();
    await loadExpiredTasks(); // 更新过期任务数量

    // 如果在历史视图，也刷新历史
    if (currentView === "history") {
      await loadHistory();
    }

    // 如果在过期任务视图，也刷新
    if (currentView === "expired") {
      await loadExpiredTasks();
    }
  } catch (error) {
    console.error("删除任务失败:", error);
  }
}

// 加载统计
async function loadStats() {
  try {
    const stats = await invoke<Stats>("get_stats", {
      taskType: currentTaskType !== "all" ? currentTaskType : null,
    });

    elements.statTotal.textContent = stats.total.toString();
    elements.statCompleted.textContent = stats.completed.toString();
    elements.statPending.textContent = stats.pending.toString();
    elements.statRate.textContent = `${Math.round(stats.completion_rate)}%`;
  } catch (error) {
    console.error("加载统计失败:", error);
  }
}

// 工具函数
function getTypeName(type: string): string {
  const names: Record<string, string> = {
    daily: "每日",
    weekly: "每周",
    monthly: "每月",
  };
  return names[type] || type;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// 全局函数（供 onclick 使用）
(window as any).completeTask = completeTask;
(window as any).deleteTask = deleteTask;

// 启动应用
window.addEventListener("DOMContentLoaded", init);
