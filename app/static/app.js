import {
  addDays,
  dateFromKey,
  dateKey,
  formatDuration,
  formatLiveDuration,
  kstDateBoundary,
  kstDateKey,
  kstParts,
  localDateTimeParts,
  localDateTimeToIso,
  overlapSeconds,
  secondsBetween,
  timeFmt,
} from "./modules/date-time.mjs?v=1b6e1e7903ff";
import {
  createReportBuckets,
  currentReportDateForMode,
  reportModeStep,
  reportPeriodCompactLabel,
  reportPeriodLabel,
  reportRangeFor,
  reportSessionSegments,
} from "./modules/reporting.mjs?v=9b60d8ef26b7";

const state = {
  tasks: [],
  sessions: [],
  taskSessions: [],
  activeSession: null,
  reportSessions: [],
  admin: null,
  sessionsMonth: null,
  reportMode: "week",
  reportDate: null,
  reportDataKey: null,
  filter: "active",
  activeView: "tasks",
  editingSessionId: null,
  isCreatingSession: false,
  isTaskEditing: false,
  editingTaskId: null,
  editingTaskColor: "#0a84ff",
  newTaskColor: "#4da1ff",
  timelineDate: null,
  timelineFollowsToday: true,
  timelineShouldCenterNow: true,
};

const fmt = new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: "numeric" });
state.reportDate = kstDateKey(new Date());
state.timelineDate = state.reportDate;
const taskColors = [
  "#bf3ff0", "#ff0a8a", "#ff0a4f", "#ff8a0a", "#ffcc1a", "#00d934", "#24bce3", "#1597ef", "#5956f4",
  "#bf7af0", "#ff7ac7", "#ff767d", "#c49a63", "#8aef00", "#10e69a", "#28d7d7", "#45d0e8", "#8198ff",
];
const autoRefreshIntervalMs = 60_000;
let autoRefreshTimer = null;
let autoRefreshInProgress = false;
const requestVersions = new Map();
const actionLocks = new Set();
let toastTimer = null;
let lastRefreshErrorAt = 0;
let sessionTaskMenuIndex = 0;

const icons = {
  play: `<svg class="row-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M8 5v14l11-7Z" /></svg>`,
  pause: `<svg class="row-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M9 5v14" /><path d="M15 5v14" /></svg>`,
  info: `<svg class="button-icon" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></svg>`,
};

function isAbortError(error) {
  return error?.name === "AbortError";
}

function nextRequestVersion(key) {
  const version = (requestVersions.get(key) || 0) + 1;
  requestVersions.set(key, version);
  return version;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (response.status === 204) return null;
  const rawBody = await response.text();
  let body = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = new Error(body?.detail || body?.message || rawBody || `Request failed (${response.status})`);
    error.status = response.status;
    error.payload = body;
    throw error;
  }
  return body;
}

async function apiLatest(key, path, options = {}) {
  const version = nextRequestVersion(key);
  let result;
  try {
    result = await api(path, options);
  } catch (error) {
    if (requestVersions.get(key) !== version || isAbortError(error)) return null;
    throw error;
  }
  return requestVersions.get(key) === version ? result : null;
}

function showToast(message, tone = "error") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast ${tone}`;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add("visible"));
  toastTimer = setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => {
      if (!toast.classList.contains("visible")) toast.hidden = true;
    }, 180);
  }, 3600);
}

function errorMessage(error, fallback = "The operation could not be completed.") {
  const message = error?.message || "";
  if (error?.status === 409) {
    if (message.includes("overlap")) return "This session overlaps an existing session.";
    if (message.includes("active")) return "Another session is already active.";
    return "The operation conflicts with the current data.";
  }
  if (error?.status === 400) {
    if (message.includes("future")) return "A session cannot be saved in the future.";
    if (message.includes("timezone")) return "Enter a date and time with a timezone.";
    return "Check the entered values.";
  }
  return fallback;
}

function reportError(error, fallback) {
  if (!isAbortError(error)) showToast(errorMessage(error, fallback));
}

async function withActionLock(key, action) {
  if (actionLocks.has(key)) return false;
  actionLocks.add(key);
  try {
    return await action();
  } finally {
    actionLocks.delete(key);
  }
}

function runSafely(action, fallback) {
  return Promise.resolve().then(action).catch((error) => reportError(error, fallback));
}

async function loadData() {
  const todayRange = monthRangeForDateKey(kstDateKey(new Date()));
  const [tasks, sessions, taskSessions, active] = await Promise.all([
    api("/api/tasks?include_archived=true"),
    fetchTimelineSessions(true),
    api(sessionsPathForRange(todayRange.start, todayRange.end)),
    fetchActiveSession(),
  ]);
  state.tasks = tasks;
  state.sessions = sessions;
  state.taskSessions = taskSessions;
  state.activeSession = active;
  render();
}

async function fetchActiveSession() {
  try {
    return await api("/api/sessions/active");
  } catch (error) {
    reportError(error, "Could not load the active session.");
    return null;
  }
}

function monthRangeForDateKey(value) {
  const date = dateFromKey(value);
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return {
    key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
    start: dateKey(start),
    end: dateKey(end),
  };
}

function sessionsPathForRange(start, end) {
  const startIso = `${start}T00:00:00+09:00`;
  const endIso = `${end}T00:00:00+09:00`;
  return `/api/sessions?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`;
}

async function fetchTimelineSessions(force = false) {
  const range = monthRangeForDateKey(state.timelineDate);
  if (!force && state.sessionsMonth === range.key) return state.sessions;
  const sessions = await apiLatest("timeline-sessions", sessionsPathForRange(range.start, range.end));
  if (sessions === null) return state.sessions;
  state.sessionsMonth = range.key;
  return sessions;
}

async function loadTimelineSessions(force = false) {
  state.sessions = await fetchTimelineSessions(force);
  renderTasks();
  renderTimeline();
}

async function loadReportData(force = false) {
  const range = reportRange();
  if (!force && state.reportDataKey === range.key) {
    renderReports();
    return;
  }
  const sessions = await apiLatest("report-sessions", sessionsPathForRange(range.start, range.end));
  if (sessions === null || reportRange().key !== range.key) return;
  state.reportSessions = sessions;
  state.reportDataKey = range.key;
  renderReports();
}

async function loadAdminData() {
  state.admin = await api("/api/admin/db");
  renderAdmin();
}

async function reloadVisibleData() {
  syncTimelineDateWithToday();
  state.reportDataKey = null;
  await loadData();
  if (state.activeView === "reports") await loadReportData(true);
  if (state.activeView === "settings") await loadAdminData();
}

function syncTimelineDateWithToday() {
  if (!state.timelineFollowsToday) return;
  const today = kstDateKey(new Date());
  if (state.timelineDate === today) return;
  state.timelineDate = today;
  state.timelineShouldCenterNow = true;
}

async function autoRefreshVisibleData() {
  if (autoRefreshInProgress || document.visibilityState !== "visible") return;
  autoRefreshInProgress = true;
  try {
    await reloadVisibleData();
  } catch (error) {
    console.error("Automatic refresh failed", error);
    if (Date.now() - lastRefreshErrorAt > autoRefreshIntervalMs) {
      showToast("Automatic refresh failed.");
      lastRefreshErrorAt = Date.now();
    }
  } finally {
    autoRefreshInProgress = false;
  }
}

function stopAutoRefresh() {
  if (autoRefreshTimer === null) return;
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
}

function startAutoRefresh() {
  stopAutoRefresh();
  if (document.visibilityState !== "visible") return;
  autoRefreshTimer = setInterval(autoRefreshVisibleData, autoRefreshIntervalMs);
}

async function handleVisibilityChange() {
  stopAutoRefresh();
  if (document.visibilityState !== "visible") return;
  await autoRefreshVisibleData();
  startAutoRefresh();
}

function activeSession() {
  return state.activeSession || state.sessions.find((session) => !session.ended_at);
}

function taskTotal(task) {
  const active = activeSession();
  if (active && active.task_id === task.id) {
    return task.total_seconds + secondsBetween(active.started_at, null);
  }
  return task.total_seconds;
}

function render() {
  syncActiveViewClass();
  document.getElementById("today-label").textContent = fmt.format(dateFromKey(kstDateKey(new Date())));
  document.getElementById("timeline-date").textContent = fmt.format(dateFromKey(state.timelineDate));
  document.getElementById("timeline-date-picker").value = state.timelineDate;
  renderActiveSessionControl();
  renderTasks();
  renderWeekStrip();
  renderTimeline();
  renderReports();
  renderAdmin();
}

function syncActiveViewClass() {
  document.body.classList.toggle("timeline-active", state.activeView === "timeline");
  document.body.classList.toggle("tasks-active", state.activeView === "tasks");
}

function updateLiveTimers() {
  const active = activeSession();
  if (!active) return;
  const runningRow = document.querySelector(`.task-row.running[data-task-id="${active.task_id}"]`);
  const time = runningRow?.querySelector(".task-time");
  const liveLabel = formatLiveDuration(secondsBetween(active.started_at, null));
  if (time) time.textContent = liveLabel;
  const activeSessionTime = document.getElementById("active-session-time");
  if (activeSessionTime) activeSessionTime.textContent = liveLabel;
}

function renderActiveSessionControl() {
  const control = document.getElementById("active-session-control");
  const active = activeSession();
  if (!control) return;
  document.body.classList.toggle("has-active-session", Boolean(active));
  control.classList.toggle("idle", !active);
  control.disabled = !active;
  control.hidden = false;
  control.setAttribute("aria-label", active ? "Stop active session" : "No active session");
  if (!active) {
    control.style.removeProperty("--task-color");
    document.getElementById("active-session-task").textContent = "No active task";
    document.getElementById("active-session-time").textContent = "0:00:00";
    return;
  }
  control.style.setProperty("--task-color", active.task_color || taskColorForSession(active));
  document.getElementById("active-session-task").textContent = active.task_name;
  document.getElementById("active-session-time").textContent = formatLiveDuration(secondsBetween(active.started_at, null));
}

async function stopActiveSession() {
  return withActionLock("stop-active-session", async () => {
    const control = document.getElementById("active-session-control");
    if (control) control.disabled = true;
    try {
      await api("/api/sessions/stop", { method: "POST" });
      await reloadVisibleData();
    } catch (error) {
      reportError(error, "Could not stop the active session.");
      renderActiveSessionControl();
    }
  });
}

function centeredTimelineScrollTop(board, lineTop, contentHeight) {
  const maxScrollTop = Math.max(0, contentHeight - board.clientHeight);
  return Math.max(0, Math.min(maxScrollTop, lineTop - board.clientHeight / 2));
}
function reportRange() {
  return reportRangeFor(state.reportMode, state.reportDate);
}

function reportEyebrowText(mode) {
  return {
    day: "Day overview",
    week: "Week overview",
    month: "Month overview",
    year: "Year overview",
  }[mode];
}

function averageLabelText(mode) {
  return {
    day: "Hourly Avg.",
    week: "Daily Avg.",
    month: "Daily Avg.",
    year: "Monthly Avg.",
  }[mode];
}

function taskColorForSession(session) {
  return session.task_color || state.tasks.find((task) => task.id === session.task_id)?.color || "#0a84ff";
}

function reportDateHeading(dateKeyValue) {
  const date = dateFromKey(dateKeyValue);
  const weekday = new Intl.DateTimeFormat("en", { weekday: "long" }).format(date);
  const monthDay = new Intl.DateTimeFormat("en", { month: "long", day: "numeric" }).format(date);
  return `${weekday}, ${monthDay}`;
}

function groupedSessionsByDate(sessions) {
  return sessions.reduce((groups, session) => {
    const key = session.segment_date || kstDateKey(session.started_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(session);
    return groups;
  }, new Map());
}

function renderTasks() {
  const list = document.getElementById("task-list");
  const entryList = document.getElementById("tasks-entry-list");
  const active = activeSession();
  const tasksView = document.getElementById("tasks-view");
  tasksView.classList.toggle("tasks-editing", state.isTaskEditing);
  document.getElementById("task-edit-toggle").textContent = state.isTaskEditing ? "Done" : "Edit";
  const rows = state.tasks.filter((task) => {
    if (state.filter === "archive") return task.archived;
    if (state.filter === "recent") return !task.archived && task.total_seconds > 0;
    return !task.archived;
  });
  renderTaskEntries(entryList);

  if (state.isTaskEditing) {
    list.innerHTML = rows.map((task) => {
      return `
        <div class="task-row editing" style="--task-color:${task.color}" data-task-id="${task.id}" draggable="true">
          <div class="task-main">
            <span class="task-run-icon">${icons.play}</span>
            <span class="task-name">${escapeHtml(task.name)}</span>
          </div>
          <button class="task-info-button" type="button" aria-label="Edit ${escapeHtml(task.name)}">${icons.info}</button>
          <div class="task-reorder-controls" aria-label="Reorder ${escapeHtml(task.name)}">
            <button class="task-move-button" type="button" data-direction="up" aria-label="Move ${escapeHtml(task.name)} up">↑</button>
            <button class="task-move-button" type="button" data-direction="down" aria-label="Move ${escapeHtml(task.name)} down">↓</button>
          </div>
        </div>
      `;
    }).join("") || `<div class="muted">No tasks here yet</div>`;

    list.querySelectorAll(".task-row").forEach((row) => bindTaskEditRow(row, rows));
    return;
  }

  list.innerHTML = rows.map((task) => {
    const isRunning = active?.task_id === task.id;
    const icon = isRunning ? "pause" : "play";
    const timeLabel = isRunning ? formatLiveDuration(secondsBetween(active.started_at, null)) : formatDuration(taskTotal(task));
    const startedLabel = isRunning ? `<span class="task-started">Started ${timeFmt.format(new Date(active.started_at))}</span>` : "";
    return `
      <button class="task-row ${isRunning ? "running" : ""}" style="--task-color:${task.color}" data-task-id="${task.id}">
        <span class="task-run-icon">${icons[icon]}</span>
        <span class="task-copy">
          <span class="task-name">${escapeHtml(task.name)}</span>
          ${startedLabel}
        </span>
        <span class="task-time">${timeLabel}</span>
      </button>
    `;
  }).join("") || `<div class="muted">No tasks here yet</div>`;

  list.querySelectorAll(".task-row").forEach((row) => {
    row.addEventListener("click", async () => {
      const taskId = Number(row.dataset.taskId);
      await withActionLock(`task-session:${taskId}`, async () => {
        row.disabled = true;
        try {
          if (active?.task_id === taskId) await stopActiveSession();
          else {
            await api(`/api/tasks/${taskId}/start`, { method: "POST" });
            await reloadVisibleData();
          }
        } catch (error) {
          reportError(error, "Could not change the session state.");
        } finally {
          if (row.isConnected) row.disabled = false;
        }
      });
    });
  });
}

function renderTaskEntries(entryList) {
  const today = kstDateKey(new Date());
  const todayStart = kstDateBoundary(today);
  const tomorrowStart = kstDateBoundary(addDays(today, 1));
  const recentSessions = state.taskSessions
    .filter((session) => session.ended_at || kstDateKey(session.started_at) === today)
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
    .slice(0, 8);
  const todaySeconds = state.taskSessions
    .reduce((total, session) => total + overlapSeconds(session, todayStart, tomorrowStart), 0);
  document.getElementById("today-total").textContent = formatDuration(todaySeconds);

  if (!recentSessions.length) {
    entryList.innerHTML = `
      <div class="entry-empty">
        <strong>No entries yet</strong>
        <span>Start a task to fill today’s timeline.</span>
      </div>
    `;
    return;
  }

  let lastDate = "";
  entryList.innerHTML = recentSessions.map((session) => {
    const sessionDate = kstDateKey(session.started_at);
    const date = dateFromKey(sessionDate);
    const heading = sessionDate === lastDate ? "" : `
      <div class="entry-day">
        <strong>${date.toLocaleDateString("en", { weekday: "long" })}</strong>
        <span>${date.toLocaleDateString("en", { month: "long", day: "numeric" })}</span>
      </div>
    `;
    lastDate = sessionDate;
    return `
      ${heading}
      <button class="entry-row session-edit-trigger" data-session-id="${session.id}" style="--task-color:${session.task_color}">
        <span class="entry-times">
          <span>${timeFmt.format(new Date(session.started_at))}</span>
          <span>${session.ended_at ? timeFmt.format(new Date(session.ended_at)) : "Running"}</span>
        </span>
        <span class="entry-marker"></span>
        <span class="entry-title">${escapeHtml(session.task_name)}</span>
        <span class="entry-note">${escapeHtml(session.notes || "")}</span>
        <strong>${formatDuration(secondsBetween(session.started_at, session.ended_at))}</strong>
      </button>
    `;
  }).join("");
  bindSessionEditTriggers(entryList);
}

function visibleTasks() {
  return state.tasks.filter((task) => {
    if (state.filter === "archive") return task.archived;
    if (state.filter === "recent") return !task.archived && task.total_seconds > 0;
    return !task.archived;
  });
}

function bindTaskEditRow(row) {
  const taskId = Number(row.dataset.taskId);
  row.querySelector(".task-info-button").addEventListener("click", () => {
    openTaskEditor(taskId);
  });
  row.querySelectorAll(".task-move-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const direction = button.dataset.direction === "up" ? -1 : 1;
      const taskIds = visibleTasks().map((task) => task.id);
      const index = taskIds.indexOf(taskId);
      const targetId = taskIds[index + direction];
      if (!targetId) return;
      await moveTaskBefore(taskId, targetId);
    });
  });
  row.addEventListener("dragstart", (event) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(taskId));
  });
  row.addEventListener("dragover", (event) => {
    event.preventDefault();
    row.classList.add("drag-over");
  });
  row.addEventListener("dragleave", () => {
    row.classList.remove("drag-over");
  });
  row.addEventListener("drop", async (event) => {
    event.preventDefault();
    row.classList.remove("drag-over");
    const sourceId = Number(event.dataTransfer.getData("text/plain"));
    if (!sourceId || sourceId === taskId) return;
    await moveTaskBefore(sourceId, taskId);
  });
}

async function moveTaskBefore(sourceId, targetId) {
  return withActionLock("reorder-tasks", async () => {
    const visibleIds = visibleTasks().map((task) => task.id);
    const fromIndex = visibleIds.indexOf(sourceId);
    const toIndex = visibleIds.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1) return;
    visibleIds.splice(fromIndex, 1);
    visibleIds.splice(toIndex, 0, sourceId);
    const visibleTaskById = new Map(state.tasks.filter((task) => visibleIds.includes(task.id)).map((task) => [task.id, task]));
    const reorderedVisibleTasks = visibleIds.map((id) => visibleTaskById.get(id));
    state.tasks = state.tasks.map((task) => {
      if (!visibleTaskById.has(task.id)) return task;
      return reorderedVisibleTasks.shift();
    });
    renderTasks();
    try {
      await api("/api/tasks/reorder", {
        method: "POST",
        body: JSON.stringify({ task_ids: state.tasks.map((task) => task.id) }),
      });
      await reloadVisibleData();
    } catch (error) {
      reportError(error, "Could not save the task order.");
      await reloadVisibleData().catch(() => null);
    }
  });
}

function openTaskEditor(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  state.editingTaskId = taskId;
  state.editingTaskColor = task.color;
  document.getElementById("edit-task-name").value = task.name;
  document.getElementById("edit-task-notes").value = task.notes || "";
  const archiveButton = document.getElementById("archive-current-task");
  archiveButton.hidden = false;
  archiveButton.textContent = task.archived ? "Unarchive Task" : "Archive Task";
  renderTaskColorPicker("edit-task-colors", state.editingTaskColor, (color) => {
    state.editingTaskColor = color;
  });
  document.getElementById("task-edit-dialog").showModal();
}

function closeTaskEditor() {
  state.editingTaskId = null;
  document.getElementById("task-edit-dialog").close();
}

function selectedTask() {
  return state.tasks.find((task) => task.id === state.editingTaskId);
}

function renderTaskColorPicker(containerId, selectedColor, onSelect) {
  const container = document.getElementById(containerId);
  container.innerHTML = taskColors.map((color) => `
    <button
      type="button"
      class="task-color-swatch ${color.toLowerCase() === selectedColor.toLowerCase() ? "selected" : ""}"
      style="--swatch:${color}"
      data-color="${color}"
      aria-label="Use color ${color}"
    ></button>
  `).join("");
  container.querySelectorAll(".task-color-swatch").forEach((button) => {
    button.addEventListener("click", () => {
      onSelect(button.dataset.color);
      renderTaskColorPicker(containerId, button.dataset.color, onSelect);
    });
  });
}

function renderWeekStrip() {
  const selectedDate = dateFromKey(state.timelineDate);
  const base = new Date(selectedDate);
  const todayKey = kstDateKey(new Date());
  base.setDate(selectedDate.getDate() - selectedDate.getDay());
  document.getElementById("week-strip").innerHTML = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(base);
    day.setDate(base.getDate() + index);
    const key = dateKey(day);
    const selected = key === state.timelineDate;
    const isToday = key === todayKey;
    return `
      <button
        class="day-pill ${selected ? "active" : ""} ${isToday ? "today" : ""}"
        data-date="${key}"
        aria-label="Show ${fmt.format(day)}${isToday ? " (today)" : ""}"
      >
        <div><strong>${String(day.getDate()).padStart(2, "0")}</strong><br>${day.toLocaleDateString("en", { weekday: "short" }).toUpperCase()}</div>
      </button>
    `;
  }).join("");
  document.querySelectorAll(".day-pill").forEach((button) => {
    button.addEventListener("click", () => {
      setTimelineDate(button.dataset.date);
    });
  });
}

async function setTimelineDate(value) {
  state.timelineDate = value;
  state.timelineFollowsToday = value === kstDateKey(new Date());
  state.timelineShouldCenterNow = state.timelineFollowsToday;
  document.getElementById("timeline-date").textContent = fmt.format(dateFromKey(state.timelineDate));
  document.getElementById("timeline-date-picker").value = state.timelineDate;
  renderWeekStrip();
  await loadTimelineSessions();
  renderTimeline();
}

function renderTimeline() {
  const board = document.getElementById("timeline-board");
  const previousScrollTop = board.scrollTop;
  const startHour = 0;
  const endHour = 24;
  const pxPerHour = 78;
  const timelinePadding = 34;
  const timelineBottomPadding = 118;
  const timelineHeight = (endHour - startHour) * pxPerHour;
  const contentHeight = timelineHeight + timelinePadding + timelineBottomPadding;
  const dayStart = kstDateBoundary(state.timelineDate);
  const dayEnd = kstDateBoundary(addDays(state.timelineDate, 1));
  const daySessions = state.sessions.filter((session) => overlapSeconds(session, dayStart, dayEnd) > 0);
  const labels = Array.from({ length: endHour - startHour + 1 }, (_, index) => {
    const hour = startHour + index;
    const label = hour === 0 || hour === 24 ? "12 AM" : hour === 12 ? "Noon" : hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
    return `<div class="time-label" style="top:${timelinePadding + index * pxPerHour}px">${label}</div>`;
  }).join("");
  const events = daySessions.map((session) => {
    const start = new Date(Math.max(new Date(session.started_at).getTime(), dayStart.getTime()));
    const end = new Date(Math.min(new Date(session.ended_at || Date.now()).getTime(), dayEnd.getTime()));
    const startLocal = (start - dayStart) / 3600000;
    const durationHours = Math.max(0.35, (end - start) / 3600000);
    const top = timelinePadding + Math.max(0, Math.min(timelineHeight - 28, (startLocal - startHour) * pxPerHour));
    const height = Math.max(28, Math.min(contentHeight - timelinePadding - top, durationHours * pxPerHour));
    const notes = (session.notes || "").trim();
    const title = notes ? `${session.task_name}\n${notes}` : session.task_name;
    return `
      <button class="timeline-event session-edit-trigger" data-session-id="${session.id}" title="${escapeHtml(title)}" style="top:${top}px;height:${height}px;--task-color:${session.task_color}">
        <span class="timeline-event-header">
          <strong class="timeline-event-title">${escapeHtml(session.task_name)}</strong>
          <span class="timeline-event-notes">${escapeHtml(notes)}</span>
          <span class="timeline-event-duration">${formatDuration((end - start) / 1000)}</span>
        </span>
      </button>
    `;
  }).join("");
  const now = new Date();
  const nowParts = kstParts(now);
  const nowHour = nowParts.hour + Number(nowParts.minute) / 60;
  const nowLineTop = timelinePadding + (nowHour - startHour) * pxPerHour;
  const nowLine = kstDateKey(now) === state.timelineDate && nowHour >= startHour && nowHour <= endHour
    ? `<div class="now-line" style="top:${nowLineTop}px"></div>`
    : "";
  board.innerHTML = `<div class="timeline-content" style="height:${contentHeight}px;--timeline-offset:${timelinePadding}px">${labels + events + nowLine}</div>`;
  if (state.timelineShouldCenterNow && nowLine && board.clientHeight > 0) {
    board.scrollTop = centeredTimelineScrollTop(board, nowLineTop, contentHeight);
    state.timelineShouldCenterNow = false;
  } else {
    board.scrollTop = previousScrollTop;
  }
  bindSessionEditTriggers(board);
}

function renderReports() {
  const totalByTask = new Map();
  const range = reportRange();
  const reportSessions = state.reportSessions;
  const buckets = createReportBuckets(state.reportMode, range);
  reportSessions.forEach((session) => {
    buckets.forEach((bucket) => {
      const seconds = overlapSeconds(session, bucket.start, bucket.end);
      if (!seconds) return;
      bucket.total += seconds;
      const existingTask = bucket.tasks.get(session.task_id) || {
        seconds: 0,
        color: taskColorForSession(session),
        name: session.task_name,
      };
      existingTask.seconds += seconds;
      bucket.tasks.set(session.task_id, existingTask);
      totalByTask.set(session.task_id, (totalByTask.get(session.task_id) || 0) + seconds);
    });
  });
  const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
  document.getElementById("total-time").textContent = formatDuration(total);
  document.getElementById("average-label").textContent = averageLabelText(state.reportMode);
  document.getElementById("period-average").textContent = formatDuration(total / Math.max(1, buckets.filter((bucket) => bucket.total > 0).length));
  document.getElementById("reports-eyebrow").textContent = reportEyebrowText(state.reportMode);
  const previousPeriodLabel = reportPeriodLabel(
    state.reportMode,
    reportModeStep(state.reportMode)(state.reportDate, -1),
    true,
  );
  const nextPeriodLabel = reportPeriodLabel(
    state.reportMode,
    reportModeStep(state.reportMode)(state.reportDate, 1),
    true,
  );
  document.getElementById("report-prev-period").setAttribute("aria-label", `Previous period, ${previousPeriodLabel}`);
  document.getElementById("report-prev-period").title = previousPeriodLabel;
  const currentPeriod = document.getElementById("report-current-period");
  const currentPeriodLabel = reportPeriodLabel(state.reportMode, state.reportDate);
  currentPeriod.setAttribute("aria-label", currentPeriodLabel);
  currentPeriod.innerHTML = `
    <span class="period-label-full">${escapeHtml(currentPeriodLabel)}</span>
    <span class="period-label-compact">${escapeHtml(reportPeriodCompactLabel(state.reportMode, state.reportDate))}</span>
  `;
  document.getElementById("report-next-period").setAttribute("aria-label", `Next period, ${nextPeriodLabel}`);
  document.getElementById("report-next-period").title = nextPeriodLabel;
  document.querySelectorAll("[data-report-range]").forEach((button) => {
    button.classList.toggle("active", button.dataset.reportRange === state.reportMode);
  });

  const maxBucket = Math.max(3600, ...buckets.map((bucket) => bucket.total));
  const chart = document.getElementById("bar-chart");
  chart.dataset.range = state.reportMode;
  chart.style.setProperty("--bar-count", buckets.length);
  chart.innerHTML = buckets.map((bucket) => {
    const height = bucket.total > 0 ? Math.max(8, (bucket.total / maxBucket) * 210) : 1;
    const segments = Array.from(bucket.tasks.values())
      .sort((a, b) => b.seconds - a.seconds)
      .map((task) => {
        const segmentHeight = bucket.total ? (task.seconds / bucket.total) * 100 : 0;
        return `<button type="button" class="bar-segment" aria-label="${escapeHtml(`${task.name}, ${formatDuration(task.seconds)}`)}" data-tooltip-name="${escapeHtml(task.name)}" data-tooltip-time="${formatDuration(task.seconds)}" style="height:${segmentHeight}%;background:${task.color}"></button>`;
      })
      .join("");
    const label = bucket.total > 0 ? `<span class="bar-total">${formatDuration(bucket.total)}</span>` : "";
    return `
      <div class="report-bar-wrap">
        ${label}
        <div class="report-bar" style="height:${height}px">${segments}</div>
        <span class="bar-label">${bucket.label}</span>
      </div>
    `;
  }).join("");

  const breakdown = state.tasks
    .filter((task) => totalByTask.has(task.id))
    .map((task) => ({ ...task, seconds: totalByTask.get(task.id) }))
    .sort((a, b) => b.seconds - a.seconds);
  document.getElementById("task-breakdown").innerHTML = breakdown.map((task) => {
    const pct = total ? Math.round((task.seconds / total) * 100) : 0;
    return `
      <div class="breakdown-row" style="--task-color:${task.color}">
        <span class="check-dot"></span>
        <div>
          <div class="task-name">${escapeHtml(task.name)}</div>
          <div class="progress-line">
            <div class="progress-track"><div class="progress-fill" style="--pct:${pct}%"></div></div>
            <span>${pct}%</span>
          </div>
        </div>
        <div class="task-time">${formatDuration(task.seconds)}</div>
      </div>
    `;
  }).join("");

  const sessionSegments = reportSessionSegments(reportSessions, range);
  const sessionList = document.getElementById("session-list");
  sessionList.innerHTML = Array.from(groupedSessionsByDate(sessionSegments).entries()).map(([date, sessions]) => {
    const dayTotal = sessions.reduce((sum, session) => sum + session.segment_seconds, 0);
    return `
      <section class="session-day-group">
        <header class="session-day-heading">
          <span>${escapeHtml(reportDateHeading(date))}</span>
          <strong>${formatDuration(dayTotal)}</strong>
        </header>
        <div class="session-day-list">
          ${sessions.map((session) => `
            <button class="session-row session-edit-trigger" data-session-id="${session.id}" style="--task-color:${session.task_color}">
              <div class="session-times">
                <span>${timeFmt.format(new Date(session.segment_started_at))}</span>
                <span>${!session.ended_at && date === kstDateKey(new Date()) ? "Running" : timeFmt.format(new Date(session.segment_ended_at))}</span>
              </div>
              <span class="session-color"></span>
              <div>
                <div class="session-title">${escapeHtml(session.task_name)}</div>
                <div class="session-notes">${escapeHtml(session.notes || "No notes")}</div>
              </div>
              <strong>${formatDuration(session.segment_seconds)}</strong>
            </button>
          `).join("")}
        </div>
      </section>
    `;
  }).join("");
  bindSessionEditTriggers(sessionList);
}

function renderAdmin() {
  if (!state.admin) return;
  document.getElementById("admin-summary").innerHTML = `
    <div class="setting-row">
      <div>
        <strong>Storage timezone</strong>
        <span>Database values are stored in UTC for stable server-side records.</span>
      </div>
      <code>${escapeHtml(state.admin.storage_timezone)}</code>
    </div>
    <div class="setting-row">
      <div>
        <strong>Display timezone</strong>
        <span>Database display columns convert timestamps for Korea.</span>
      </div>
      <code>${escapeHtml(state.admin.display_timezone)}</code>
    </div>
    <div class="setting-row">
      <div>
        <strong>Database file</strong>
        <span>Local SQLite path used by this server.</span>
      </div>
      <code>${escapeHtml(state.admin.db_path)}</code>
    </div>
  `;
}

function moveChartTooltip(event) {
  const tooltip = document.getElementById("chart-tooltip");
  const offset = 14;
  const rect = tooltip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - rect.width - 12, event.clientX + offset);
  const top = Math.max(12, event.clientY - rect.height - offset);
  tooltip.style.left = `${Math.max(12, left)}px`;
  tooltip.style.top = `${top}px`;
}

function showChartTooltip(target, event) {
  showChartTooltipAt(target, event.clientX, event.clientY);
}

function showChartTooltipAt(target, clientX, clientY) {
  const tooltip = document.getElementById("chart-tooltip");
  tooltip.querySelector("strong").textContent = target.dataset.tooltipName || "";
  tooltip.querySelector("span").textContent = target.dataset.tooltipTime || "";
  tooltip.setAttribute("aria-hidden", "false");
  tooltip.classList.add("visible");
  moveChartTooltip({ clientX, clientY });
}

function hideChartTooltip() {
  const tooltip = document.getElementById("chart-tooltip");
  tooltip.setAttribute("aria-hidden", "true");
  tooltip.classList.remove("visible");
}

function bindSessionEditTriggers(root) {
  root.querySelectorAll(".session-edit-trigger").forEach((element) => {
    element.addEventListener("click", () => openSessionEditor(Number(element.dataset.sessionId)));
  });
}

function selectedSession() {
  if (state.isCreatingSession) return null;
  return [
    ...state.sessions,
    ...state.taskSessions,
    ...state.reportSessions,
  ].find((session) => session.id === state.editingSessionId);
}

function availableSessionTasks(session) {
  return state.tasks.filter((task) => !task.archived || task.id === session.task_id);
}

function selectedSessionTask() {
  const taskId = Number(document.getElementById("session-task").value);
  return state.tasks.find((task) => task.id === taskId);
}

function closeSessionTaskMenu() {
  const menu = document.getElementById("session-task-menu");
  const button = document.getElementById("session-task-button");
  menu.classList.remove("open");
  button.setAttribute("aria-expanded", "false");
  menu.removeAttribute("aria-activedescendant");
}

function focusSessionTaskOption(index) {
  const options = [...document.querySelectorAll(".session-task-option")];
  if (!options.length) return;
  sessionTaskMenuIndex = (index + options.length) % options.length;
  const option = options[sessionTaskMenuIndex];
  const menu = document.getElementById("session-task-menu");
  options.forEach((item) => item.classList.toggle("active", item === option));
  menu.setAttribute("aria-activedescendant", option.id);
  menu.focus();
}

function openSessionTaskMenu() {
  const menu = document.getElementById("session-task-menu");
  const isOpen = menu.classList.contains("open");
  if (isOpen) return;
  menu.classList.add("open");
  document.getElementById("session-task-button").setAttribute("aria-expanded", "true");
  const selectedIndex = [...document.querySelectorAll(".session-task-option")].findIndex((option) => option.classList.contains("selected"));
  focusSessionTaskOption(selectedIndex >= 0 ? selectedIndex : 0);
}

function updateSessionTaskButton() {
  const task = selectedSessionTask();
  const button = document.getElementById("session-task-button");
  if (!task) {
    button.innerHTML = "<span>Select task</span>";
    return;
  }
  button.style.setProperty("--task-color", task.color);
  button.innerHTML = `
    <span class="task-picker-dot"></span>
    <span class="task-picker-name">${escapeHtml(task.name)}</span>
    <span class="task-picker-chevron">⌄</span>
  `;
}

function renderSessionTaskPicker(session) {
  const tasks = availableSessionTasks(session);
  const select = document.getElementById("session-task");
  select.innerHTML = tasks.map((task) => `<option value="${task.id}">${escapeHtml(task.name)}</option>`).join("");
  select.value = String(session.task_id);
  const selectedId = Number(select.value);
  sessionTaskMenuIndex = Math.max(0, tasks.findIndex((task) => task.id === selectedId));
  document.getElementById("session-task-menu").innerHTML = tasks.map((task) => `
    <button
      id="session-task-option-${task.id}"
      class="session-task-option ${task.id === selectedId ? "selected" : ""}"
      type="button"
      role="option"
      tabindex="-1"
      aria-selected="${task.id === selectedId ? "true" : "false"}"
      data-task-id="${task.id}"
      style="--task-color:${task.color}"
    >
      <span class="task-picker-dot"></span>
      <span>${escapeHtml(task.name)}</span>
      <span class="task-picker-check">${task.id === selectedId ? "✓" : ""}</span>
    </button>
  `).join("");
  updateSessionTaskButton();
}

function setSessionTask(taskId) {
  document.getElementById("session-task").value = String(taskId);
  const session = selectedSession();
  renderSessionTaskPicker({ ...(session || {}), task_id: Number(taskId) });
  closeSessionTaskMenu();
  document.getElementById("session-task-button").focus();
}

function setSessionDialogMode(mode) {
  const isCreating = mode === "create";
  state.isCreatingSession = isCreating;
  document.getElementById("session-dialog-title").textContent = isCreating ? "New Session" : "Edit Session";
  document.getElementById("save-session").textContent = isCreating ? "Create" : "Save";
  document.getElementById("delete-session").hidden = isCreating;
}

function sessionTime(prefix) {
  const hour = document.getElementById(`session-${prefix}-hour`).value.trim();
  const minute = document.getElementById(`session-${prefix}-minute`).value.trim();
  if (!hour && !minute) return "";
  return `${hour}:${minute}`;
}

function setSessionTime(prefix, value) {
  const [hour = "", minute = ""] = value ? value.split(":") : [];
  document.getElementById(`session-${prefix}-hour`).value = hour;
  document.getElementById(`session-${prefix}-minute`).value = minute;
}

function openSessionCreator() {
  const task = state.tasks.find((item) => !item.archived) || state.tasks[0];
  if (!task) return;
  const now = new Date();
  const nowParts = kstParts(now);
  const startTime = kstDateKey(now) === state.timelineDate
    ? `${String(nowParts.hour).padStart(2, "0")}:${nowParts.minute}`
    : "09:00";
  const startIso = localDateTimeToIso(state.timelineDate, startTime);
  const end = localDateTimeParts(new Date(new Date(startIso).getTime() + 3600000));
  state.editingSessionId = null;
  setSessionDialogMode("create");
  renderSessionTaskPicker({ task_id: task.id });
  document.getElementById("session-start-date").value = state.timelineDate;
  setSessionTime("start", startTime);
  document.getElementById("session-end-date").value = end.date;
  setSessionTime("end", end.time);
  document.getElementById("session-notes").value = "";
  showSessionFormError("");
  updateSessionDurationPreview();
  document.getElementById("session-dialog").showModal();
}

function openSessionEditor(sessionId) {
  const session = [
    ...state.sessions,
    ...state.taskSessions,
    ...state.reportSessions,
  ].find((item) => item.id === sessionId);
  if (!session) return;
  state.editingSessionId = sessionId;
  setSessionDialogMode("edit");
  renderSessionTaskPicker(session);
  const start = localDateTimeParts(session.started_at);
  const end = localDateTimeParts(session.ended_at);
  document.getElementById("session-start-date").value = start.date;
  setSessionTime("start", start.time);
  document.getElementById("session-end-date").value = end.date || "";
  setSessionTime("end", end.time || "");
  document.getElementById("session-notes").value = session.notes || "";
  showSessionFormError("");
  updateSessionDurationPreview();
  document.getElementById("session-dialog").showModal();
}

function closeSessionEditor() {
  state.editingSessionId = null;
  state.isCreatingSession = false;
  closeSessionTaskMenu();
  document.getElementById("session-dialog").close();
}

function updateSessionDurationPreview() {
  const values = getSessionFormValues(false);
  document.getElementById("session-duration").textContent = values?.startedAt
    ? formatDuration(secondsBetween(values.startedAt, values.endedAt))
    : "0:00";
}

function showSessionFormError(message) {
  const error = document.getElementById("session-form-error");
  error.textContent = message || "";
  error.hidden = !message;
}

function getSessionFormValues(showError = true) {
  const startDate = document.getElementById("session-start-date").value;
  const startTime = sessionTime("start");
  const endDate = document.getElementById("session-end-date").value;
  const endTime = sessionTime("end");
  const startHourInput = document.getElementById("session-start-hour");
  const startMinuteInput = document.getElementById("session-start-minute");
  const endHourInput = document.getElementById("session-end-hour");
  const endMinuteInput = document.getElementById("session-end-minute");
  [startHourInput, startMinuteInput, endHourInput, endMinuteInput].forEach((input) => input.setCustomValidity(""));

  const setError = (message, inputs = [startHourInput, startMinuteInput]) => {
    inputs.forEach((input) => input.setCustomValidity(message));
    if (showError) showSessionFormError(message);
    return null;
  };
  if (!startDate || !startTime) return setError("Enter a start date and time.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) return setError("Enter a valid start hour and minute.");
  if (Boolean(endDate) !== Boolean(endTime)) return setError("Enter both an end date and an end time.", [endHourInput, endMinuteInput]);
  if (endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) return setError("Enter a valid end hour and minute.", [endHourInput, endMinuteInput]);

  const startedAt = localDateTimeToIso(startDate, startTime);
  const endedAt = endDate && endTime ? localDateTimeToIso(endDate, endTime) : null;
  if (!startedAt) return setError("Check the start date and time.");
  if (endDate && endTime && !endedAt) return setError("Check the end date and time.", [endHourInput, endMinuteInput]);
  if (endedAt && new Date(endedAt) <= new Date(startedAt)) return setError("The end time must be after the start time.", [endHourInput, endMinuteInput]);
  if (showError) showSessionFormError("");
  return { startedAt, endedAt };
}

function confirmAction({ title, message, actionLabel = "Delete" }) {
  return new Promise((resolve) => {
    const dialog = document.getElementById("confirm-dialog");
    const accept = document.getElementById("confirm-accept");
    const cancel = document.getElementById("confirm-cancel");
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-message").textContent = message;
    accept.textContent = actionLabel;

    const cleanup = (result) => {
      accept.removeEventListener("click", onAccept);
      cancel.removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClose);
      if (dialog.open) dialog.close();
      resolve(result);
    };
    const onAccept = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onClose = () => cleanup(false);

    accept.addEventListener("click", onAccept);
    cancel.addEventListener("click", onCancel);
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onClose);
    dialog.showModal();
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

async function showView(viewName) {
  state.activeView = viewName;
  syncActiveViewClass();
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === viewName));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `${viewName}-view`));
  if (viewName === "timeline" && state.timelineShouldCenterNow) requestAnimationFrame(renderTimeline);
  if (viewName === "reports") await loadReportData();
  if (viewName === "settings") await loadAdminData();
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    runSafely(() => showView(button.dataset.view), "Could not load the view.");
  });
});

document.getElementById("brand-home").addEventListener("click", () => {
  runSafely(() => showView("tasks"), "Could not load the view.");
});

function activateTaskFilter(button) {
  state.filter = button.dataset.filter;
  document.querySelectorAll(".task-tab").forEach((item) => {
    const selected = item === button;
    item.classList.toggle("active", selected);
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
  });
  document.getElementById("task-panel-content").setAttribute("aria-labelledby", button.id);
  renderTasks();
}

document.querySelectorAll(".task-tab").forEach((button, index, buttons) => {
  button.addEventListener("click", () => activateTaskFilter(button));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[nextIndex].focus();
    activateTaskFilter(buttons[nextIndex]);
  });
});

document.getElementById("task-edit-toggle").addEventListener("click", () => {
  state.isTaskEditing = !state.isTaskEditing;
  renderTasks();
});

document.getElementById("add-task").addEventListener("click", () => {
  state.newTaskColor = taskColors[7];
  renderTaskColorPicker("task-colors", state.newTaskColor, (color) => {
    state.newTaskColor = color;
  });
  document.getElementById("task-dialog").showModal();
});

document.getElementById("cancel-new-task").addEventListener("click", () => {
  document.getElementById("task-dialog").close();
});

document.getElementById("task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await withActionLock("create-task", async () => {
    const name = document.getElementById("task-name").value.trim();
    const color = state.newTaskColor;
    if (!name) return;
    try {
      await api("/api/tasks", { method: "POST", body: JSON.stringify({ name, color }) });
      document.getElementById("task-name").value = "";
      document.getElementById("task-dialog").close();
      await reloadVisibleData();
    } catch (error) {
      reportError(error, "Could not create the task.");
    }
  });
});

document.getElementById("timeline-reports").addEventListener("click", () => {
  runSafely(() => showView("reports"), "Could not load reports.");
});
document.getElementById("timeline-add-session").addEventListener("click", openSessionCreator);
document.getElementById("bar-chart").addEventListener("pointermove", (event) => {
  const segment = event.target.closest(".bar-segment");
  if (!segment) {
    hideChartTooltip();
    return;
  }
  showChartTooltip(segment, event);
});
document.getElementById("bar-chart").addEventListener("focusin", (event) => {
  const segment = event.target.closest(".bar-segment");
  if (!segment) return;
  const rect = segment.getBoundingClientRect();
  showChartTooltipAt(segment, rect.left + rect.width / 2, rect.top);
});
document.getElementById("bar-chart").addEventListener("focusout", (event) => {
  if (!event.relatedTarget || !event.relatedTarget.closest?.(".bar-segment")) hideChartTooltip();
});
document.getElementById("bar-chart").addEventListener("pointerleave", hideChartTooltip);
document.querySelectorAll("[data-report-range]").forEach((button) => {
  button.addEventListener("click", async () => {
    state.reportMode = button.dataset.reportRange;
    state.reportDataKey = null;
    await runSafely(() => loadReportData(true), "Could not load reports.");
  });
});
document.getElementById("report-prev-period").addEventListener("click", async () => {
  state.reportDate = reportModeStep(state.reportMode)(state.reportDate, -1);
  state.reportDataKey = null;
  await runSafely(() => loadReportData(true), "Could not load reports.");
});
document.getElementById("report-next-period").addEventListener("click", async () => {
  state.reportDate = reportModeStep(state.reportMode)(state.reportDate, 1);
  state.reportDataKey = null;
  await runSafely(() => loadReportData(true), "Could not load reports.");
});
document.getElementById("report-current-reset").addEventListener("click", async () => {
  state.reportDate = currentReportDateForMode(state.reportMode);
  state.reportDataKey = null;
  await runSafely(() => loadReportData(true), "Could not load reports.");
});
document.getElementById("report-current-period").addEventListener("click", async () => {
  state.reportDate = currentReportDateForMode(state.reportMode);
  state.reportDataKey = null;
  await runSafely(() => loadReportData(true), "Could not load reports.");
});
document.getElementById("refresh-admin").addEventListener("click", () => {
  runSafely(loadAdminData, "Could not load settings.");
});
document.getElementById("timeline-date").addEventListener("click", () => {
  const picker = document.getElementById("timeline-date-picker");
  if (typeof picker.showPicker === "function") picker.showPicker();
  else picker.focus();
});
document.getElementById("timeline-date-picker").addEventListener("change", (event) => {
  if (event.target.value) runSafely(() => setTimelineDate(event.target.value), "Could not load the timeline.");
});
document.getElementById("cancel-task-edit").addEventListener("click", closeTaskEditor);
document.getElementById("task-edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await withActionLock("edit-task", async () => {
    const task = selectedTask();
    if (!task) return;
    const name = document.getElementById("edit-task-name").value.trim();
    if (!name) return;
    try {
      await api(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          color: state.editingTaskColor,
          notes: document.getElementById("edit-task-notes").value,
        }),
      });
      closeTaskEditor();
      await reloadVisibleData();
    } catch (error) {
      reportError(error, "Could not save the task.");
    }
  });
});
document.getElementById("delete-current-task").addEventListener("click", async () => {
  await withActionLock("delete-task", async () => {
    const task = selectedTask();
    if (!task) return;
    const confirmed = await confirmAction({
      title: "Delete Task",
      message: `Delete ${task.name}? Sessions for this task will also be removed.`,
      actionLabel: "Delete Task",
    });
    if (!confirmed) return;
    try {
      await api(`/api/tasks/${task.id}`, { method: "DELETE" });
      closeTaskEditor();
      await reloadVisibleData();
    } catch (error) {
      reportError(error, "Could not delete the task.");
    }
  });
});
document.getElementById("archive-current-task").addEventListener("click", async () => {
  await withActionLock("archive-task", async () => {
    const task = selectedTask();
    if (!task) return;
    try {
      await api(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: !task.archived }),
      });
      closeTaskEditor();
      await reloadVisibleData();
    } catch (error) {
      reportError(error, "Could not change the task archive state.");
    }
  });
});
document.getElementById("cancel-session-edit").addEventListener("click", closeSessionEditor);
document.getElementById("session-task-button").addEventListener("click", () => {
  const menu = document.getElementById("session-task-menu");
  if (menu.classList.contains("open")) closeSessionTaskMenu();
  else openSessionTaskMenu();
});
document.getElementById("session-task-button").addEventListener("keydown", (event) => {
  const menu = document.getElementById("session-task-menu");
  if (["ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    openSessionTaskMenu();
    focusSessionTaskOption(sessionTaskMenuIndex + (event.key === "ArrowUp" ? -1 : 1));
  } else if (["Enter", " "].includes(event.key)) {
    event.preventDefault();
    if (menu.classList.contains("open")) closeSessionTaskMenu();
    else openSessionTaskMenu();
  } else if (event.key === "Escape") {
    closeSessionTaskMenu();
  }
});
document.getElementById("session-task-menu").addEventListener("keydown", (event) => {
  const options = [...document.querySelectorAll(".session-task-option")];
  if (!options.length) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusSessionTaskOption(sessionTaskMenuIndex + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    focusSessionTaskOption(sessionTaskMenuIndex - 1);
  } else if (event.key === "Home") {
    event.preventDefault();
    focusSessionTaskOption(0);
  } else if (event.key === "End") {
    event.preventDefault();
    focusSessionTaskOption(options.length - 1);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeSessionTaskMenu();
    document.getElementById("session-task-button").focus();
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    setSessionTask(Number(options[sessionTaskMenuIndex].dataset.taskId));
  }
});
document.getElementById("session-task-menu").addEventListener("click", (event) => {
  const option = event.target.closest(".session-task-option");
  if (!option) return;
  setSessionTask(Number(option.dataset.taskId));
});
document.addEventListener("click", (event) => {
  if (!document.getElementById("session-dialog").open) return;
  if (event.target.closest(".session-task-field")) return;
  closeSessionTaskMenu();
});
document.getElementById("session-start-date").addEventListener("input", updateSessionDurationPreview);
document.querySelectorAll("#session-start-hour, #session-start-minute, #session-end-hour, #session-end-minute").forEach((input) => {
  input.addEventListener("input", updateSessionDurationPreview);
});
document.getElementById("session-end-date").addEventListener("input", updateSessionDurationPreview);
document.getElementById("session-form").addEventListener("invalid", () => {
  showSessionFormError("Check the date and time format.");
}, true);
document.getElementById("session-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await withActionLock("save-session", async () => {
    const session = selectedSession();
    if (!state.isCreatingSession && !session) return;
    const values = getSessionFormValues(true);
    if (!values) return;
    const payload = {
      task_id: Number(document.getElementById("session-task").value),
      started_at: values.startedAt,
      ended_at: values.endedAt,
      notes: document.getElementById("session-notes").value,
    };
    try {
      await api(state.isCreatingSession ? "/api/sessions" : `/api/sessions/${session.id}`, {
        method: state.isCreatingSession ? "POST" : "PATCH",
        body: JSON.stringify(payload),
      });
      closeSessionEditor();
      await reloadVisibleData();
    } catch (error) {
      reportError(error, "Could not save the session.");
    }
  });
});
document.getElementById("delete-session").addEventListener("click", async () => {
  await withActionLock("delete-session", async () => {
    const session = selectedSession();
    if (!session) return;
    const confirmed = await confirmAction({
      title: "Delete Session",
      message: "Delete this session? This action cannot be undone.",
      actionLabel: "Delete Session",
    });
    if (!confirmed) return;
    try {
      await api(`/api/sessions/${session.id}`, { method: "DELETE" });
      closeSessionEditor();
      await reloadVisibleData();
    } catch (error) {
      reportError(error, "Could not delete the session.");
    }
  });
});

document.getElementById("active-session-control").addEventListener("click", stopActiveSession);

loadData().catch((error) => reportError(error, "Could not load the dashboard data."));
setInterval(updateLiveTimers, 1000);
startAutoRefresh();
document.addEventListener("visibilitychange", handleVisibilityChange);
