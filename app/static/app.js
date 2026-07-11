const state = {
  tasks: [],
  sessions: [],
  taskSessions: [],
  activeSession: null,
  reportSessions: [],
  admin: null,
  sessionsMonth: null,
  reportMode: "month",
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
  timelineShouldCenterNow: true,
};

const fmt = new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const kstPartsFmt = new Intl.DateTimeFormat("en", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
state.reportDate = kstDateKey(new Date());
state.timelineDate = state.reportDate;
const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const weekdayNames = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const fullMonthDayFmt = new Intl.DateTimeFormat("en", { month: "long", day: "numeric" });
const fullMonthYearFmt = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" });
const taskColors = [
  "#bf3ff0", "#ff0a8a", "#ff0a4f", "#ff8a0a", "#ffcc1a", "#00d934", "#24bce3", "#1597ef", "#5956f4",
  "#bf7af0", "#ff7ac7", "#ff767d", "#c49a63", "#8aef00", "#10e69a", "#28d7d7", "#45d0e8", "#8198ff",
];

const icons = {
  play: `<svg class="row-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M8 5v14l11-7Z" /></svg>`,
  pause: `<svg class="row-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M9 5v14" /><path d="M15 5v14" /></svg>`,
  info: `<svg class="button-icon" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></svg>`,
  grip: `<svg class="button-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M8 6h.01" /><path d="M16 6h.01" /><path d="M8 12h.01" /><path d="M16 12h.01" /><path d="M8 18h.01" /><path d="M16 18h.01" /></svg>`,
};

function secondsBetween(start, end) {
  return Math.max(0, Math.floor((new Date(end || Date.now()) - new Date(start)) / 1000));
}

function kstDateBoundary(date, hour = 0) {
  return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+09:00`);
}

function overlapSeconds(session, rangeStart, rangeEnd) {
  const start = Math.max(new Date(session.started_at).getTime(), rangeStart.getTime());
  const sessionEnd = session.ended_at ? new Date(session.ended_at).getTime() : Date.now();
  const end = Math.min(sessionEnd, rangeEnd.getTime());
  return Math.max(0, Math.floor((end - start) / 1000));
}

function formatDuration(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function formatLiveDuration(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function localDateTimeParts(value) {
  if (!value) return "";
  const parts = kstParts(value);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${String(parts.hour).padStart(2, "0")}:${parts.minute}`,
  };
}

function localDateTimeToIso(date, time) {
  if (!date || !time) return null;
  return new Date(`${date}T${time}:00+09:00`).toISOString();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error(await response.text());
  if (response.status === 204) return null;
  return response.json();
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
  return api("/api/sessions/active").catch(() => null);
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
  const sessions = await api(sessionsPathForRange(range.start, range.end));
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
  state.reportSessions = await api(sessionsPathForRange(range.start, range.end));
  state.reportDataKey = range.key;
  renderReports();
}

async function loadAdminData() {
  state.admin = await api("/api/admin/db");
  renderAdmin();
}

async function reloadVisibleData() {
  await loadData();
  if (state.activeView === "reports") await loadReportData(true);
  if (state.activeView === "settings") await loadAdminData();
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
  await api("/api/sessions/stop", { method: "POST" }).catch(() => null);
  await reloadVisibleData();
}

function kstParts(value) {
  const parts = Object.fromEntries(kstPartsFmt.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: Number(parts.hour),
    minute: parts.minute,
    second: parts.second,
  };
}

function kstDateKey(value) {
  const parts = kstParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateKey(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function dateFromKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function centeredTimelineScrollTop(board, lineTop, contentHeight) {
  const maxScrollTop = Math.max(0, contentHeight - board.clientHeight);
  return Math.max(0, Math.min(maxScrollTop, lineTop - board.clientHeight / 2));
}

function addDays(value, amount) {
  const date = dateFromKey(value);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

function addMonths(value, amount) {
  const date = dateFromKey(value);
  date.setMonth(date.getMonth() + amount);
  return dateKey(date);
}

function addYears(value, amount) {
  const date = dateFromKey(value);
  date.setFullYear(date.getFullYear() + amount);
  return dateKey(date);
}

function startOfWeekKey(value) {
  const date = dateFromKey(value);
  date.setDate(date.getDate() - date.getDay());
  return dateKey(date);
}

function reportRangeFor(mode, value) {
  const date = dateFromKey(value);
  if (mode === "day") {
    const start = dateKey(date);
    return { start, end: addDays(start, 1), key: `${mode}:${start}` };
  }
  if (mode === "week") {
    const start = startOfWeekKey(value);
    return { start, end: addDays(start, 7), key: `${mode}:${start}` };
  }
  if (mode === "month") {
    const start = dateKey(new Date(date.getFullYear(), date.getMonth(), 1));
    return { start, end: addMonths(start, 1), key: `${mode}:${start}` };
  }
  const start = `${date.getFullYear()}-01-01`;
  return { start, end: `${date.getFullYear() + 1}-01-01`, key: `${mode}:${start}` };
}

function reportRange() {
  return reportRangeFor(state.reportMode, state.reportDate);
}

function reportModeStep(mode) {
  if (mode === "day") return (value, amount) => addDays(value, amount);
  if (mode === "week") return (value, amount) => addDays(value, amount * 7);
  if (mode === "month") return addMonths;
  return addYears;
}

function reportPeriodLabel(mode, value, compact = false) {
  const date = dateFromKey(value);
  if (mode === "day") {
    return compact ? fullMonthDayFmt.format(date) : fmt.format(date);
  }
  if (mode === "week") {
    const start = dateFromKey(startOfWeekKey(value));
    const end = dateFromKey(addDays(dateKey(start), 6));
    if (compact) return fullMonthDayFmt.format(start);
    return `${fullMonthDayFmt.format(start)}, ${start.getFullYear()} - ${fullMonthDayFmt.format(end)}, ${end.getFullYear()}`;
  }
  if (mode === "month") {
    return fullMonthYearFmt.format(date);
  }
  return String(date.getFullYear());
}

function currentReportDateForMode(mode) {
  const today = kstDateKey(new Date());
  if (mode === "week") return startOfWeekKey(today);
  if (mode === "month") {
    const date = dateFromKey(today);
    return dateKey(new Date(date.getFullYear(), date.getMonth(), 1));
  }
  if (mode === "year") {
    const date = dateFromKey(today);
    return `${date.getFullYear()}-01-01`;
  }
  return today;
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

function createReportBuckets(mode, range) {
  if (mode === "day") {
    return Array.from({ length: 24 }, (_, index) => ({
      key: String(index).padStart(2, "0"),
      label: index % 3 === 0 ? String(index).padStart(2, "0") : "",
      start: kstDateBoundary(range.start, index),
      end: index === 23 ? kstDateBoundary(range.end) : kstDateBoundary(range.start, index + 1),
      total: 0,
      tasks: new Map(),
    }));
  }
  if (mode === "week") {
    return Array.from({ length: 7 }, (_, index) => {
      const key = addDays(range.start, index);
      const date = dateFromKey(key);
      return {
        key,
        label: `${weekdayNames[date.getDay()]}<span>${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}</span>`,
        start: kstDateBoundary(key),
        end: kstDateBoundary(addDays(key, 1)),
        total: 0,
        tasks: new Map(),
      };
    });
  }
  if (mode === "month") {
    const start = dateFromKey(range.start);
    const end = dateFromKey(range.end);
    const length = Math.round((end - start) / 86400000);
    return Array.from({ length }, (_, index) => {
      const key = addDays(range.start, index);
      const date = dateFromKey(key);
      return {
        key,
        label: String(date.getDate()),
        start: kstDateBoundary(key),
        end: kstDateBoundary(addDays(key, 1)),
        total: 0,
        tasks: new Map(),
      };
    });
  }
  const year = Number(range.start.slice(0, 4));
  return monthNames.map((label, index) => {
    const start = `${year}-${String(index + 1).padStart(2, "0")}-01`;
    const end = index === 11 ? `${year + 1}-01-01` : `${year}-${String(index + 2).padStart(2, "0")}-01`;
    return {
      key: String(index),
      label,
      start: kstDateBoundary(start),
      end: kstDateBoundary(end),
      total: 0,
      tasks: new Map(),
    };
  });
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

function reportSessionSegments(sessions, range) {
  const rangeStart = kstDateBoundary(range.start);
  const rangeEnd = kstDateBoundary(range.end);
  const segments = [];
  sessions.forEach((session) => {
    const sessionStart = new Date(session.started_at);
    const sessionEnd = new Date(session.ended_at || Date.now());
    let cursor = new Date(Math.max(sessionStart.getTime(), rangeStart.getTime()));
    const clippedEnd = new Date(Math.min(sessionEnd.getTime(), rangeEnd.getTime()));
    while (cursor < clippedEnd) {
      const date = kstDateKey(cursor);
      const nextDay = kstDateBoundary(addDays(date, 1));
      const segmentEnd = new Date(Math.min(nextDay.getTime(), clippedEnd.getTime()));
      segments.push({
        ...session,
        segment_date: date,
        segment_started_at: cursor.toISOString(),
        segment_ended_at: segmentEnd.toISOString(),
        segment_seconds: Math.floor((segmentEnd - cursor) / 1000),
      });
      cursor = segmentEnd;
    }
  });
  return segments.sort((a, b) => new Date(b.segment_started_at) - new Date(a.segment_started_at));
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
          <button class="task-info-button" aria-label="Edit ${escapeHtml(task.name)}">${icons.info}</button>
          <button class="task-drag-handle" aria-label="Move ${escapeHtml(task.name)}">${icons.grip}</button>
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
      if (active?.task_id === taskId) await stopActiveSession();
      else await api(`/api/tasks/${taskId}/start`, { method: "POST" });
      if (active?.task_id !== taskId) await reloadVisibleData();
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
  await api("/api/tasks/reorder", {
    method: "POST",
    body: JSON.stringify({ task_ids: state.tasks.map((task) => task.id) }),
  });
  await reloadVisibleData();
}

function openTaskEditor(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  state.editingTaskId = taskId;
  state.editingTaskColor = task.color;
  document.getElementById("edit-task-name").value = task.name;
  document.getElementById("edit-task-notes").value = task.notes || "";
  document.getElementById("archive-current-task").hidden = Boolean(task.archived);
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
  state.timelineShouldCenterNow = value === kstDateKey(new Date());
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
  document.getElementById("report-current-period").textContent = reportPeriodLabel(state.reportMode, state.reportDate);
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
        return `<span class="bar-segment" data-tooltip-name="${escapeHtml(task.name)}" data-tooltip-time="${formatDuration(task.seconds)}" style="height:${segmentHeight}%;background:${task.color}"></span>`;
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
  const tooltip = document.getElementById("chart-tooltip");
  tooltip.querySelector("strong").textContent = target.dataset.tooltipName || "";
  tooltip.querySelector("span").textContent = target.dataset.tooltipTime || "";
  tooltip.setAttribute("aria-hidden", "false");
  tooltip.classList.add("visible");
  moveChartTooltip(event);
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
  document.getElementById("session-task-menu").classList.remove("open");
  document.getElementById("session-task-button").setAttribute("aria-expanded", "false");
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
  document.getElementById("session-task-menu").innerHTML = tasks.map((task) => `
    <button
      class="session-task-option ${task.id === selectedId ? "selected" : ""}"
      type="button"
      role="option"
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
}

function setSessionDialogMode(mode) {
  const isCreating = mode === "create";
  state.isCreatingSession = isCreating;
  document.getElementById("session-dialog-title").textContent = isCreating ? "New Session" : "Edit Session";
  document.getElementById("save-session").textContent = isCreating ? "Create" : "Save";
  document.getElementById("delete-session").hidden = isCreating;
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
  document.getElementById("session-start-time").value = startTime;
  document.getElementById("session-end-date").value = end.date;
  document.getElementById("session-end-time").value = end.time;
  document.getElementById("session-notes").value = "";
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
  document.getElementById("session-start-time").value = start.time;
  document.getElementById("session-end-date").value = end.date || "";
  document.getElementById("session-end-time").value = end.time || "";
  document.getElementById("session-notes").value = session.notes || "";
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
  const start = localDateTimeToIso(
    document.getElementById("session-start-date").value,
    document.getElementById("session-start-time").value,
  );
  const end = localDateTimeToIso(
    document.getElementById("session-end-date").value,
    document.getElementById("session-end-time").value,
  );
  document.getElementById("session-duration").textContent = start
    ? formatDuration(secondsBetween(start, end))
    : "0:00";
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
    showView(button.dataset.view);
  });
});

document.querySelectorAll(".task-tab").forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll(".task-tab").forEach((item) => item.classList.toggle("active", item === button));
    renderTasks();
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
  const name = document.getElementById("task-name").value.trim();
  const color = state.newTaskColor;
  if (!name) return;
  await api("/api/tasks", { method: "POST", body: JSON.stringify({ name, color }) });
  document.getElementById("task-name").value = "";
  document.getElementById("task-dialog").close();
  await reloadVisibleData();
});

document.getElementById("timeline-reports").addEventListener("click", () => {
  showView("reports");
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
document.getElementById("bar-chart").addEventListener("pointerleave", hideChartTooltip);
document.querySelectorAll("[data-report-range]").forEach((button) => {
  button.addEventListener("click", async () => {
    state.reportMode = button.dataset.reportRange;
    state.reportDataKey = null;
    await loadReportData(true);
  });
});
document.getElementById("report-prev-period").addEventListener("click", async () => {
  state.reportDate = reportModeStep(state.reportMode)(state.reportDate, -1);
  state.reportDataKey = null;
  await loadReportData(true);
});
document.getElementById("report-next-period").addEventListener("click", async () => {
  state.reportDate = reportModeStep(state.reportMode)(state.reportDate, 1);
  state.reportDataKey = null;
  await loadReportData(true);
});
document.getElementById("report-current-reset").addEventListener("click", async () => {
  state.reportDate = currentReportDateForMode(state.reportMode);
  state.reportDataKey = null;
  await loadReportData(true);
});
document.getElementById("report-current-period").addEventListener("click", async () => {
  state.reportDate = currentReportDateForMode(state.reportMode);
  state.reportDataKey = null;
  await loadReportData(true);
});
document.getElementById("report-current-period").addEventListener("keydown", async (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  state.reportDate = currentReportDateForMode(state.reportMode);
  state.reportDataKey = null;
  await loadReportData(true);
});
document.getElementById("refresh-admin").addEventListener("click", loadAdminData);
document.getElementById("timeline-date").addEventListener("click", () => {
  const picker = document.getElementById("timeline-date-picker");
  if (typeof picker.showPicker === "function") picker.showPicker();
  else picker.focus();
});
document.getElementById("timeline-date-picker").addEventListener("change", (event) => {
  if (event.target.value) setTimelineDate(event.target.value);
});
document.getElementById("cancel-task-edit").addEventListener("click", closeTaskEditor);
document.getElementById("task-edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const task = selectedTask();
  if (!task) return;
  const name = document.getElementById("edit-task-name").value.trim();
  if (!name) return;
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
});
document.getElementById("delete-current-task").addEventListener("click", async () => {
  const task = selectedTask();
  if (!task) return;
  const confirmed = await confirmAction({
    title: "Delete Task",
    message: `Delete ${task.name}? Sessions for this task will also be removed.`,
    actionLabel: "Delete Task",
  });
  if (!confirmed) return;
  await api(`/api/tasks/${task.id}`, { method: "DELETE" });
  closeTaskEditor();
  await reloadVisibleData();
});
document.getElementById("archive-current-task").addEventListener("click", async () => {
  const task = selectedTask();
  if (!task) return;
  await api(`/api/tasks/${task.id}`, {
    method: "PATCH",
    body: JSON.stringify({ archived: !task.archived }),
  });
  closeTaskEditor();
  await reloadVisibleData();
});
document.getElementById("cancel-session-edit").addEventListener("click", closeSessionEditor);
document.getElementById("session-task-button").addEventListener("click", () => {
  const menu = document.getElementById("session-task-menu");
  const isOpen = menu.classList.toggle("open");
  document.getElementById("session-task-button").setAttribute("aria-expanded", String(isOpen));
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
document.getElementById("session-start-time").addEventListener("input", updateSessionDurationPreview);
document.getElementById("session-end-date").addEventListener("input", updateSessionDurationPreview);
document.getElementById("session-end-time").addEventListener("input", updateSessionDurationPreview);
document.getElementById("session-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const session = selectedSession();
  if (!state.isCreatingSession && !session) return;
  const payload = {
    task_id: Number(document.getElementById("session-task").value),
    started_at: localDateTimeToIso(
      document.getElementById("session-start-date").value,
      document.getElementById("session-start-time").value,
    ),
    ended_at: localDateTimeToIso(
      document.getElementById("session-end-date").value,
      document.getElementById("session-end-time").value,
    ),
    notes: document.getElementById("session-notes").value,
  };
  await api(state.isCreatingSession ? "/api/sessions" : `/api/sessions/${session.id}`, {
    method: state.isCreatingSession ? "POST" : "PATCH",
    body: JSON.stringify(payload),
  });
  closeSessionEditor();
  await reloadVisibleData();
});
document.getElementById("delete-session").addEventListener("click", async () => {
  const session = selectedSession();
  if (!session) return;
  const confirmed = await confirmAction({
    title: "Delete Session",
    message: "Delete this session? This action cannot be undone.",
    actionLabel: "Delete Session",
  });
  if (!confirmed) return;
  await api(`/api/sessions/${session.id}`, { method: "DELETE" });
  closeSessionEditor();
  await reloadVisibleData();
});

document.getElementById("active-session-control").addEventListener("click", stopActiveSession);

loadData();
setInterval(updateLiveTimers, 1000);
