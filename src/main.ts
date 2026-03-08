import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

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

interface PageFilter {
  page?: number;
  page_size?: number;
}

interface PaginatedTasks {
  tasks: Task[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

interface ContributionDay {
  date: string;
  count: number;
}

interface TaskPointStats {
  total: number;
  completed: number;
  pending: number;
}

// 状态
let currentView: "tasks" | "history" | "expired" | "annual" | "settings" = "tasks";
let currentTaskType: string = "all";
let historyType: "completed" | "uncompleted" = "completed";

// 分页状态
let currentPage: number = 1;
const PAGE_SIZE: number = 20;
let totalPages: number = 1;

// 当前任务点相关的任务ID
let currentTaskIdForPoints: number | null = null;

// DOM 元素
const elements = {
  // 视图
  viewTasks: document.getElementById("view-tasks") as HTMLDivElement,
  viewHistory: document.getElementById("view-history") as HTMLDivElement,
  viewExpired: document.getElementById("view-expired") as HTMLDivElement,
  viewAnnual: document.getElementById("view-annual") as HTMLDivElement,
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

  // 分页
  expiredPagination: document.getElementById("expired-pagination") as HTMLDivElement,
  historyPagination: document.getElementById("history-pagination") as HTMLDivElement,

  // 贡献热力图
  contributionGraph: document.getElementById("contribution-graph") as HTMLDivElement,

  // 导入导出按钮
  btnImportTasks: document.getElementById("btn-import-tasks") as HTMLButtonElement,
  btnExportTasks: document.getElementById("btn-export-tasks") as HTMLButtonElement,

  // 设置页面元素
  viewSettings: document.getElementById("view-settings") as HTMLDivElement,
  importTemplate: document.getElementById("import-template") as HTMLPreElement,
  exportExample: document.getElementById("export-example") as HTMLPreElement,
  btnCopyTemplate: document.getElementById("btn-copy-template") as HTMLButtonElement,
  btnCopyExport: document.getElementById("btn-copy-export") as HTMLButtonElement,
  btnImportFromTemplate: document.getElementById("btn-import-from-template") as HTMLButtonElement,
  btnExportCurrent: document.getElementById("btn-export-current") as HTMLButtonElement,

  // 任务点弹窗
  modalTaskPoints: document.getElementById("modal-task-points") as HTMLDivElement,
  modalTaskPointsClose: document.getElementById("modal-task-points-close") as HTMLButtonElement,
  taskPointsTitle: document.getElementById("task-points-title") as HTMLHeadingElement,
  taskPointsStats: document.getElementById("task-points-stats") as HTMLDivElement,
  pointsCompletedCount: document.getElementById("points-completed-count") as HTMLSpanElement,
  pointsPendingCount: document.getElementById("points-pending-count") as HTMLSpanElement,
  formAddTaskPoint: document.getElementById("form-add-task-point") as HTMLFormElement,
  taskPointTitle: document.getElementById("task-point-title") as HTMLInputElement,
  taskPointsList: document.getElementById("task-points-list") as HTMLDivElement,
};

// 初始化
async function init() {
  setupEventListeners();
  await loadStats();
  await loadTasks();
  await loadExpiredTasks(); // 加载过期任务数量
  await loadContributionData(); // 加载贡献数据
}

// 事件监听
function setupEventListeners() {
  // 导航点击
  elements.navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const view = item.dataset.view as "tasks" | "history" | "expired" | "annual" | "settings";
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
      } else if (view === "annual") {
        currentView = "annual";
        showAnnualView();
      } else if (view === "settings") {
        currentView = "settings";
        showSettingsView();
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

  // 点击侧边栏贡献卡片跳转到年度记录
  elements.contributionGraph.addEventListener("click", () => {
    const annualNavItem = document.querySelector('.nav-item[data-view="annual"]');
    if (annualNavItem) {
      annualNavItem.dispatchEvent(new Event("click"));
    }
  });

  // 导入任务按钮
  elements.btnImportTasks.addEventListener("click", importTasks);

  // 导出任务按钮
  elements.btnExportTasks.addEventListener("click", exportTasks);

  // 设置页面按钮
  elements.btnCopyTemplate.addEventListener("click", async () => {
    const success = await copyToClipboard(elements.importTemplate.textContent || "");
    if (success) {
      elements.btnCopyTemplate.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> 已复制`;
      setTimeout(() => {
        elements.btnCopyTemplate.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> 复制模板`;
      }, 2000);
    }
  });

  elements.btnCopyExport.addEventListener("click", async () => {
    const success = await copyToClipboard(elements.exportExample.textContent || "");
    if (success) {
      elements.btnCopyExport.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> 已复制`;
      setTimeout(() => {
        elements.btnCopyExport.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> 复制示例`;
      }, 2000);
    }
  });

  elements.btnImportFromTemplate.addEventListener("click", async () => {
    const templateText = elements.importTemplate.textContent;
    try {
      await invoke("import_tasks_from_json", { jsonContent: templateText });
      await loadTasks();
      await loadStats();
      await loadExpiredTasks();
      alert("模板任务导入成功！");
    } catch (error) {
      console.error("导入失败:", error);
      alert("导入失败: " + error);
    }
  });

  elements.btnExportCurrent.addEventListener("click", async () => {
    await exportTasks();
  });

  // 关闭任务点弹窗
  elements.modalTaskPointsClose.addEventListener("click", closeTaskPointsModal);
  elements.modalTaskPoints.querySelector(".modal-backdrop")?.addEventListener("click", closeTaskPointsModal);

  // 添加任务点
  elements.formAddTaskPoint.addEventListener("submit", async (e) => {
    e.preventDefault();
    await createTaskPoint();
  });
}

// 显示任务视图
async function showTasksView(type: string) {
  elements.viewTasks.style.display = "block";
  elements.viewHistory.style.display = "none";
  elements.viewExpired.style.display = "none";
  elements.viewAnnual.style.display = "none";
  elements.viewSettings.style.display = "none";

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
  elements.viewAnnual.style.display = "none";
  elements.viewSettings.style.display = "none";

  // 更新标题
  const titles: Record<string, string> = {
    completed: "提交记录",
    uncompleted: "未完成任务",
  };
  elements.pageTitle.textContent = titles[type] || "历史记录";

  // 隐藏新建任务按钮
  elements.btnAddTask.style.display = "none";

  // 重置分页
  currentPage = 1;

  // 加载历史记录
  historyType = type as "completed" | "uncompleted";
  await loadHistory();
}

// 显示过期任务视图
async function showExpiredView() {
  elements.viewTasks.style.display = "none";
  elements.viewHistory.style.display = "none";
  elements.viewExpired.style.display = "block";
  elements.viewAnnual.style.display = "none";
  elements.viewSettings.style.display = "none";

  // 更新标题
  elements.pageTitle.textContent = "过期任务";

  // 隐藏新建任务按钮
  elements.btnAddTask.style.display = "none";

  // 重置分页
  currentPage = 1;

  // 加载过期任务
  await loadExpiredTasks();
}

// 显示年度记录视图
async function showAnnualView() {
  elements.viewTasks.style.display = "none";
  elements.viewHistory.style.display = "none";
  elements.viewExpired.style.display = "none";
  elements.viewAnnual.style.display = "block";
  elements.viewSettings.style.display = "none";

  // 隐藏新建任务按钮
  elements.btnAddTask.style.display = "none";

  // 加载年度记录数据
  await loadAnnualData();
}

// 加载年度记录数据
async function loadAnnualData() {
  try {
    const contributions = await invoke<ContributionDay[]>("get_contribution_data");
    renderAnnualGraph(contributions);

    // 计算统计数据
    let total = 0;
    let completed = 0;
    contributions.forEach((c) => {
      total += c.count;
      completed += c.count;
    });

    // 计算连续天数
    const streak = calculateStreak(contributions);

    // 更新统计显示
    const annualTotalEl = document.getElementById("annual-total");
    const annualCompletedEl = document.getElementById("annual-completed");
    const annualStreakEl = document.getElementById("annual-streak");

    if (annualTotalEl) annualTotalEl.textContent = total.toString();
    if (annualCompletedEl) annualCompletedEl.textContent = completed.toString();
    if (annualStreakEl) annualStreakEl.textContent = streak.toString();
  } catch (error) {
    console.error("加载年度记录失败:", error);
  }
}

// 计算连续完成任务天数
function calculateStreak(contributions: ContributionDay[]): number {
  if (contributions.length === 0) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let streak = 0;
  let currentDate = new Date(today);

  // 创建一个日期到完成数的映射
  const contributionMap = new Map<string, number>();
  contributions.forEach((c) => {
    contributionMap.set(c.date, c.count);
  });

  // 从今天开始往前数
  while (true) {
    const dateStr = currentDate.toISOString().split("T")[0];
    const count = contributionMap.get(dateStr);

    if (count && count > 0) {
      streak++;
      currentDate.setDate(currentDate.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

// 渲染年度大图
function renderAnnualGraph(contributions: ContributionDay[]) {
  const container = document.getElementById("contribution-graph-large");
  if (!container) return;

  const contributionMap = new Map<string, number>();
  contributions.forEach((c) => {
    contributionMap.set(c.date, c.count);
  });

  const today = new Date();
  const days: string[] = [];

  // 找到第一个周一
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 52 * 7 - today.getDay() + 1);

  for (let i = 0; i < 53 * 7; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    if (date <= today) {
      days.push(date.toISOString().split("T")[0]);
    }
  }

  let maxCount = 0;
  contributions.forEach((c) => {
    if (c.count > maxCount) maxCount = c.count;
  });

  const html = days
    .map((date) => {
      const count = contributionMap.get(date) || 0;
      let level = 0;
      if (maxCount > 0) {
        const ratio = count / maxCount;
        if (ratio === 0) level = 0;
        else if (ratio <= 0.25) level = 1;
        else if (ratio <= 0.5) level = 2;
        else if (ratio <= 0.75) level = 3;
        else level = 4;
      }
      return `<div class="contribution-day level-${level}" title="${date}: ${count}个任务"></div>`;
    })
    .join("");

  container.innerHTML = html;

  // 渲染月份标签
  const monthsEl = document.getElementById("annual-months");
  if (monthsEl) {
    const months = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
    const monthLabels: string[] = [];
    let lastMonth = -1;

    days.forEach((date, index) => {
      const month = new Date(date).getMonth();
      if (month !== lastMonth) {
        monthLabels.push(`<span style="grid-column: ${Math.floor(index / 7) + 1}">${months[month]}</span>`);
        lastMonth = month;
      }
    });

    monthsEl.innerHTML = monthLabels.join("");
  }
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
    const pagination: PageFilter = { page: currentPage, page_size: PAGE_SIZE };
    const result = await invoke<PaginatedTasks>("get_expired_tasks", {
      taskType: currentTaskType !== "all" ? currentTaskType : null,
      pagination,
    });
    renderExpiredTasks(result.tasks);
    updateExpiredCount(result.total);
    totalPages = result.total_pages;
    renderPagination(elements.expiredPagination);
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
        <button class="btn-action btn-task-points" onclick="openTaskPointsModal(${task.id}, '${escapeHtml(task.title)}')" title="任务点">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="8" y1="6" x2="21" y2="6"/>
            <line x1="8" y1="12" x2="21" y2="12"/>
            <line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/>
            <line x1="3" y1="12" x2="3.01" y2="12"/>
            <line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
        </button>
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
        <button class="btn-action btn-task-points" onclick="openTaskPointsModal(${task.id}, '${escapeHtml(task.title)}')" title="任务点">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="8" y1="6" x2="21" y2="6"/>
            <line x1="8" y1="12" x2="21" y2="12"/>
            <line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/>
            <line x1="3" y1="12" x2="3.01" y2="12"/>
            <line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
        </button>
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

    const pagination: PageFilter = { page: currentPage, page_size: PAGE_SIZE };

    let result: PaginatedTasks;

    if (historyType === "completed") {
      result = await invoke<PaginatedTasks>("get_completed_history", { filter, pagination });
    } else {
      result = await invoke<PaginatedTasks>("get_uncompleted_history", { filter, pagination });
    }

    renderHistory(result.tasks);
    totalPages = result.total_pages;
    renderPagination(elements.historyPagination);
  } catch (error) {
    console.error("加载历史记录失败:", error);
  }
}

// 渲染历史记录 - GitHub 风格
function renderHistory(tasks: Task[]) {
  if (tasks.length === 0) {
    elements.historyList.innerHTML = "";
    elements.emptyHistory.style.display = "flex";
    return;
  }

  elements.emptyHistory.style.display = "none";

  // 使用 GitHub 风格的提交时间线
  elements.historyList.innerHTML = `
    <div class="commit-timeline">
      ${tasks
        .map(
          (task) => `
        <div class="commit-item ${task.completed ? "completed" : ""}" data-id="${task.id}">
          <div class="commit-header">
            <span class="commit-title">${escapeHtml(task.title)}</span>
            <span class="commit-time">${task.completed_at ? formatDate(task.completed_at) : ""}</span>
          </div>
          <div class="commit-meta">
            <span class="task-type-badge ${task.task_type}">${getTypeName(task.task_type)}</span>
            <span class="commit-hash">${generateShortHash(task.id)}</span>
            <span>创建于 ${formatDate(task.created_at)}</span>
          </div>
          <div class="task-actions" style="margin-top: 8px;">
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
        .join("")}
    </div>
  `;
}

// 生成短哈希（用于模拟 Git commit hash）
function generateShortHash(id: number): string {
  const hash = id.toString(16).padStart(7, "0");
  return hash.substring(0, 7);
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

// 导入任务
async function importTasks() {
  try {
    const selected = await open({
      multiple: false,
      filters: [{
        name: "JSON",
        extensions: ["json"]
      }]
    });

    if (selected) {
      const content = await readTextFile(selected as string);
      await invoke("import_tasks_from_json", { jsonContent: content });
      await loadTasks();
      await loadStats();
      await loadExpiredTasks();
      alert("任务导入成功！");
    }
  } catch (error) {
    console.error("导入任务失败:", error);
    alert("导入失败: " + error);
  }
}

// 导出任务
async function exportTasks() {
  try {
    const savePath = await save({
      filters: [{
        name: "JSON",
        extensions: ["json"]
      }],
      defaultPath: "tasks.json"
    });

    if (savePath) {
      const jsonContent = await invoke<string>("export_tasks_to_json", { includeCompleted: false });
      await writeTextFile(savePath, jsonContent);
      alert("任务导出成功！");
    }
  } catch (error) {
    console.error("导出任务失败:", error);
    alert("导出失败: " + error);
  }
}

// 显示设置视图
function showSettingsView() {
  elements.viewTasks.style.display = "none";
  elements.viewExpired.style.display = "none";
  elements.viewHistory.style.display = "none";
  elements.viewAnnual.style.display = "none";
  elements.viewSettings.style.display = "block";
  elements.pageTitle.textContent = "设置";

  // 隐藏新建任务按钮
  elements.btnAddTask.style.display = "none";

  // 渲染模板
  renderTemplates();
}

// 渲染模板
function renderTemplates() {
  const importTemplateJson = {
    tasks: [
      {
        title: "每日英语学习",
        task_type: "daily",
        due_date: "2026-03-08 23:59:59"
      },
      {
        title: "每周技术总结",
        task_type: "weekly",
        due_date: "2026-03-15 23:59:59"
      },
      {
        title: "月度项目评估",
        task_type: "monthly",
        due_date: "2026-04-08 23:59:59"
      },
      {
        title: "年度学习计划",
        task_type: "yearly",
        due_date: "2027-03-08 23:59:59"
      }
    ]
  };

  const exportExampleJson = {
    tasks: [
      {
        title: "示例任务1",
        task_type: "daily",
        due_date: ""
      },
      {
        title: "示例任务2",
        task_type: "weekly",
        due_date: ""
      }
    ]
  };

  elements.importTemplate.textContent = JSON.stringify(importTemplateJson, null, 2);
  elements.exportExample.textContent = JSON.stringify(exportExampleJson, null, 2);
}

// 复制到剪贴板
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error("复制失败:", error);
    // 备用方法
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      document.body.removeChild(textarea);
      return true;
    } catch (e) {
      document.body.removeChild(textarea);
      return false;
    }
  }
}

// 打开任务点弹窗
async function openTaskPointsModal(taskId: number, taskTitle: string) {
  currentTaskIdForPoints = taskId;
  elements.taskPointsTitle.textContent = taskTitle + " - 任务点";
  elements.modalTaskPoints.classList.add("active");
  await loadTaskPoints();
}

// 关闭任务点弹窗
function closeTaskPointsModal() {
  elements.modalTaskPoints.classList.remove("active");
  currentTaskIdForPoints = null;
}

// 加载任务点
async function loadTaskPoints() {
  if (!currentTaskIdForPoints) return;

  try {
    const points = await invoke<Task[]>("get_task_points", { parentId: currentTaskIdForPoints });
    const stats = await invoke<TaskPointStats>("get_task_point_stats", { parentId: currentTaskIdForPoints });

    elements.pointsCompletedCount.textContent = stats.completed.toString();
    elements.pointsPendingCount.textContent = stats.pending.toString();

    renderTaskPoints(points);
  } catch (error) {
    console.error("加载任务点失败:", error);
  }
}

// 渲染任务点列表
function renderTaskPoints(points: Task[]) {
  if (points.length === 0) {
    elements.taskPointsList.innerHTML = '<div class="task-points-empty">暂无任务点，点击下方添加</div>';
    return;
  }

  elements.taskPointsList.innerHTML = points
    .map((point) => `
      <div class="task-point-item ${point.completed ? "completed" : ""}" data-id="${point.id}">
        <label class="task-point-checkbox">
          <input type="checkbox" ${point.completed ? "checked" : ""} onchange="completeTaskPoint(${point.id})">
          <span class="checkbox-custom"></span>
        </label>
        <span class="task-point-title">${escapeHtml(point.title)}</span>
        <button class="btn-delete-point" onclick="deleteTaskPoint(${point.id})" title="删除">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            <line x1="10" y1="11" x2="10" y2="17"/>
            <line x1="14" y1="11" x2="14" y2="17"/>
          </svg>
        </button>
      </div>
    `)
    .join("");
}

// 创建任务点
async function createTaskPoint() {
  if (!currentTaskIdForPoints) return;

  const title = elements.taskPointTitle.value.trim();
  if (!title) return;

  try {
    await invoke("create_task_point", { parentId: currentTaskIdForPoints, title });
    elements.taskPointTitle.value = "";
    await loadTaskPoints();
    await loadTasks(); // 刷新任务列表以更新任务点数量
  } catch (error) {
    console.error("创建任务点失败:", error);
  }
}

// 完成任务点
async function completeTaskPoint(id: number) {
  try {
    await invoke("complete_task_point", { id });
    await loadTaskPoints();
    await loadTasks(); // 刷新任务列表
  } catch (error) {
    console.error("完成任务点失败:", error);
  }
}

// 删除任务点
async function deleteTaskPoint(id: number) {
  try {
    await invoke("delete_task_point", { id });
    await loadTaskPoints();
    await loadTasks(); // 刷新任务列表
  } catch (error) {
    console.error("删除任务点失败:", error);
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

// 加载贡献数据
async function loadContributionData() {
  try {
    const contributions = await invoke<ContributionDay[]>("get_contribution_data");
    renderContributionGraph(contributions);
  } catch (error) {
    console.error("加载贡献数据失败:", error);
  }
}

// 渲染贡献热力图
function renderContributionGraph(contributions: ContributionDay[]) {
  const contributionMap = new Map<string, number>();
  contributions.forEach((c) => {
    contributionMap.set(c.date, c.count);
  });

  // 生成过去26周的日期（每周从周一开始）- 侧边栏简化版
  const today = new Date();
  const days: string[] = [];

  // 找到上一个周一的日期（过去26周）
  const monday = new Date(today);
  monday.setDate(today.getDate() - today.getDay() - (26 * 7) + 1);

  for (let i = 0; i < 26 * 7; i++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    if (date <= today) {
      const dateStr = date.toISOString().split("T")[0];
      days.push(dateStr);
    }
  }

  // 确定最大贡献数
  let maxCount = 0;
  contributions.forEach((c) => {
    if (c.count > maxCount) maxCount = c.count;
  });

  // 渲染格子
  const html = days
    .map((date) => {
      const count = contributionMap.get(date) || 0;
      let level = 0;
      if (maxCount > 0) {
        const ratio = count / maxCount;
        if (ratio === 0) level = 0;
        else if (ratio <= 0.25) level = 1;
        else if (ratio <= 0.5) level = 2;
        else if (ratio <= 0.75) level = 3;
        else level = 4;
      }
      return `<div class="contribution-day level-${level}" title="${date}: ${count}个任务"></div>`;
    })
    .join("");

  elements.contributionGraph.innerHTML = html;
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
    year: "numeric",
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

// 渲染分页
function renderPagination(container: HTMLDivElement) {
  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  let html = `
    <button class="pagination-btn" onclick="goToPage(${currentPage - 1})" ${currentPage <= 1 ? "disabled" : ""}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    </button>
  `;

  // 页码按钮
  const maxVisiblePages = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

  if (endPage - startPage < maxVisiblePages - 1) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  if (startPage > 1) {
    html += `<button class="pagination-btn" onclick="goToPage(1)">1</button>`;
    if (startPage > 2) {
      html += `<span class="pagination-info">...</span>`;
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="pagination-btn ${i === currentPage ? "active" : ""}" onclick="goToPage(${i})">${i}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      html += `<span class="pagination-info">...</span>`;
    }
    html += `<button class="pagination-btn" onclick="goToPage(${totalPages})">${totalPages}</button>`;
  }

  html += `
    <button class="pagination-btn" onclick="goToPage(${currentPage + 1})" ${currentPage >= totalPages ? "disabled" : ""}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>
  `;

  container.innerHTML = html;
}

// 跳转页面
async function goToPage(page: number) {
  if (page < 1 || page > totalPages) return;
  currentPage = page;

  if (currentView === "expired") {
    await loadExpiredTasks();
  } else if (currentView === "history") {
    await loadHistory();
  }
}

// 全局函数（供 onclick 使用）
(window as any).completeTask = completeTask;
(window as any).deleteTask = deleteTask;
(window as any).goToPage = goToPage;
(window as any).openTaskPointsModal = openTaskPointsModal;
(window as any).completeTaskPoint = completeTaskPoint;
(window as any).deleteTaskPoint = deleteTaskPoint;

// 启动应用
window.addEventListener("DOMContentLoaded", init);
