const state = {
  tasks: [],
  sessions: [],
  admin: null,
  filter: "active",
  activeView: "tasks",
  editingSessionId: null,
};

const fmt = new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit" });
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
const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function secondsBetween(start, end) {
  return Math.max(0, Math.floor((new Date(end || Date.now()) - new Date(start)) / 1000));
}

function formatDuration(seconds, showSeconds = false) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (showSeconds) return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function dateTimeLocalValue(value) {
  if (!value) return "";
  const parts = kstParts(value);
  return `${parts.year}-${parts.month}-${parts.day}T${String(parts.hour).padStart(2, "0")}:${parts.minute}:${parts.second}`;
}

function localInputToIso(value) {
  if (!value) return null;
  return new Date(`${value}+09:00`).toISOString();
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
  const [tasks, sessions, admin] = await Promise.all([
    api("/api/tasks?include_archived=true"),
    api("/api/sessions"),
    api("/api/admin/db"),
  ]);
  state.tasks = tasks;
  state.sessions = sessions;
  state.admin = admin;
  render();
}

function activeSession() {
  return state.sessions.find((session) => !session.ended_at);
}

function taskTotal(task) {
  const active = activeSession();
  if (active && active.task_id === task.id) {
    return task.total_seconds + secondsBetween(active.started_at, null);
  }
  return task.total_seconds;
}

function render() {
  document.getElementById("today-label").textContent = fmt.format(new Date());
  document.getElementById("timeline-date").textContent = fmt.format(new Date(2026, 6, 7));
  renderTasks();
  renderLiveSession();
  renderWeekStrip();
  renderTimeline();
  renderReports();
  renderAdmin();
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

function kstHourFraction(value) {
  const parts = kstParts(value);
  return parts.hour + Number(parts.minute) / 60;
}

function kstMonthIndex(value) {
  return Number(kstParts(value).month) - 1;
}

function renderTasks() {
  const list = document.getElementById("task-list");
  const active = activeSession();
  const rows = state.tasks.filter((task) => {
    if (state.filter === "archive") return task.archived;
    if (state.filter === "recent") return !task.archived && task.total_seconds > 0;
    return !task.archived;
  });

  list.innerHTML = rows.map((task) => {
    const isRunning = active?.task_id === task.id;
    const icon = isRunning ? "pause" : "play";
    return `
      <button class="task-row ${isRunning ? "running" : ""}" style="--task-color:${task.color}" data-task-id="${task.id}">
        <span class="${icon}"></span>
        <span class="task-name">${escapeHtml(task.name)}</span>
        <span class="task-time">${formatDuration(taskTotal(task), isRunning)}</span>
      </button>
    `;
  }).join("") || `<div class="muted">No tasks here yet</div>`;

  list.querySelectorAll(".task-row").forEach((row) => {
    row.addEventListener("click", async () => {
      const taskId = Number(row.dataset.taskId);
      if (active?.task_id === taskId) await api("/api/sessions/stop", { method: "POST" }).catch(() => null);
      else await api(`/api/tasks/${taskId}/start`, { method: "POST" });
      await loadData();
    });
  });
}

function renderLiveSession() {
  const live = document.getElementById("live-session");
  const session = activeSession();
  if (!session) {
    live.innerHTML = `<span class="muted">No task is running</span>`;
    return;
  }
  live.style.borderColor = session.task_color;
  live.innerHTML = `
    <div>
      <div class="live-title" style="color:${session.task_color}">${escapeHtml(session.task_name)}</div>
      <div class="muted">Started ${timeFmt.format(new Date(session.started_at))}</div>
    </div>
    <div class="live-time">${formatDuration(secondsBetween(session.started_at, null), true)}</div>
  `;
}

function renderWeekStrip() {
  const base = new Date(2026, 6, 5);
  document.getElementById("week-strip").innerHTML = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(base);
    day.setDate(base.getDate() + index);
    return `
      <div class="day-pill ${index === 2 ? "active" : ""}">
        <div><strong>${String(day.getDate()).padStart(2, "0")}</strong><br>${day.toLocaleDateString("en", { weekday: "short" }).toUpperCase()}</div>
      </div>
    `;
  }).join("");
}

function renderTimeline() {
  const board = document.getElementById("timeline-board");
  const startHour = 9;
  const endHour = 22;
  const pxPerHour = 78;
  const daySessions = state.sessions.filter((session) => kstDateKey(session.started_at) === "2026-07-07");
  const labels = Array.from({ length: endHour - startHour + 1 }, (_, index) => {
    const hour = startHour + index;
    const label = hour === 12 ? "Noon" : hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
    return `<div class="time-label" style="top:${index * pxPerHour}px">${label}</div>`;
  }).join("");
  const events = daySessions.map((session) => {
    const end = new Date(session.ended_at || Date.now());
    const start = new Date(session.started_at);
    const startLocal = kstHourFraction(session.started_at);
    const durationHours = Math.max(0.35, (end - start) / 3600000);
    const top = Math.max(0, (startLocal - startHour) * pxPerHour);
    const height = Math.max(28, durationHours * pxPerHour);
    return `
      <button class="timeline-event session-edit-trigger" data-session-id="${session.id}" style="top:${top}px;height:${height}px;--task-color:${session.task_color}">
        ${escapeHtml(session.task_name)} <span>${formatDuration(secondsBetween(session.started_at, session.ended_at))}</span>
      </button>
    `;
  }).join("");
  const now = new Date();
  const nowHour = now.getHours() + now.getMinutes() / 60;
  const nowLine = nowHour >= startHour && nowHour <= endHour
    ? `<div class="now-line" style="top:${(nowHour - startHour) * pxPerHour}px"></div>`
    : "";
  board.innerHTML = labels + events + nowLine;
  bindSessionEditTriggers(board);
}

function renderReports() {
  const totalByTask = new Map();
  const totalByMonth = Array(12).fill(0);
  state.sessions.forEach((session) => {
    const seconds = secondsBetween(session.started_at, session.ended_at);
    totalByTask.set(session.task_id, (totalByTask.get(session.task_id) || 0) + seconds);
    totalByMonth[kstMonthIndex(session.started_at)] += seconds;
  });
  const total = totalByMonth.reduce((sum, value) => sum + value, 0);
  document.getElementById("total-time").textContent = formatDuration(total);
  document.getElementById("monthly-average").textContent = formatDuration(total / Math.max(1, totalByMonth.filter(Boolean).length));
  const maxMonth = Math.max(3600, ...totalByMonth);
  document.getElementById("bar-chart").innerHTML = totalByMonth.map((seconds, index) => {
    const height = Math.max(1, (seconds / maxMonth) * 210);
    const color = index === 6 ? "#ffcc1a" : "#0a84ff";
    return `<div class="month-bar" data-month="${monthNames[index]}" style="height:${height}px;background:${color}"></div>`;
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
          <div class="progress-track"><div class="progress-fill" style="--pct:${pct}%"></div></div>
        </div>
        <div class="task-time">${formatDuration(task.seconds)}</div>
      </div>
    `;
  }).join("");

  const sessionList = document.getElementById("session-list");
  sessionList.innerHTML = state.sessions.map((session) => `
    <button class="session-row session-edit-trigger" data-session-id="${session.id}" style="--task-color:${session.task_color}">
      <div class="session-times">
        <span>${timeFmt.format(new Date(session.started_at))}</span>
        <span>${session.ended_at ? timeFmt.format(new Date(session.ended_at)) : "Running"}</span>
      </div>
      <span class="session-color"></span>
      <div>
        <div class="session-title">${escapeHtml(session.task_name)}</div>
        <div class="session-notes">${escapeHtml(session.notes || "No notes")}</div>
      </div>
      <strong>${formatDuration(secondsBetween(session.started_at, session.ended_at))}</strong>
    </button>
  `).join("");
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
        <span>Admin display columns convert timestamps for Korea.</span>
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
  document.getElementById("admin-session-rows").innerHTML = state.admin.sessions.map((session) => `
    <tr class="admin-session-row session-edit-trigger" data-session-id="${session.id}">
      <td>${session.id}</td>
      <td><span class="admin-task-dot" style="--task-color:${session.task_color}"></span>${escapeHtml(session.task_name)}</td>
      <td><code>${escapeHtml(session.started_at)}</code></td>
      <td>${escapeHtml(session.started_at_kst)}</td>
      <td>${escapeHtml(session.ended_at_kst || "Running")}</td>
      <td>${formatDuration(session.duration_seconds, true)}</td>
    </tr>
  `).join("");
  bindSessionEditTriggers(document.getElementById("admin-session-rows"));
}

function bindSessionEditTriggers(root) {
  root.querySelectorAll(".session-edit-trigger").forEach((element) => {
    element.addEventListener("click", () => openSessionEditor(Number(element.dataset.sessionId)));
  });
}

function selectedSession() {
  return state.sessions.find((session) => session.id === state.editingSessionId);
}

function openSessionEditor(sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) return;
  state.editingSessionId = sessionId;
  document.getElementById("session-task").innerHTML = state.tasks
    .filter((task) => !task.archived || task.id === session.task_id)
    .map((task) => `<option value="${task.id}">${escapeHtml(task.name)}</option>`)
    .join("");
  document.getElementById("session-task").value = String(session.task_id);
  document.getElementById("session-start").value = dateTimeLocalValue(session.started_at);
  document.getElementById("session-end").value = dateTimeLocalValue(session.ended_at);
  document.getElementById("session-notes").value = session.notes || "";
  updateSessionDurationPreview();
  document.getElementById("session-dialog").showModal();
}

function closeSessionEditor() {
  state.editingSessionId = null;
  document.getElementById("session-dialog").close();
}

function updateSessionDurationPreview() {
  const start = localInputToIso(document.getElementById("session-start").value);
  const endValue = document.getElementById("session-end").value;
  const end = endValue ? localInputToIso(endValue) : null;
  document.getElementById("session-duration").textContent = start
    ? formatDuration(secondsBetween(start, end), true)
    : "00:00:00";
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

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    state.activeView = button.dataset.view;
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `${state.activeView}-view`));
  });
});

document.querySelectorAll(".task-tab").forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll(".task-tab").forEach((item) => item.classList.toggle("active", item === button));
    renderTasks();
  });
});

document.getElementById("add-task").addEventListener("click", () => {
  document.getElementById("task-dialog").showModal();
});

document.getElementById("task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.getElementById("task-name").value.trim();
  const color = document.getElementById("task-color").value;
  if (!name) return;
  await api("/api/tasks", { method: "POST", body: JSON.stringify({ name, color }) });
  document.getElementById("task-name").value = "";
  document.getElementById("task-dialog").close();
  await loadData();
});

document.getElementById("stop-session").addEventListener("click", async () => {
  await api("/api/sessions/stop", { method: "POST" }).catch(() => null);
  await loadData();
});

document.getElementById("refresh-timeline").addEventListener("click", loadData);
document.getElementById("refresh-admin").addEventListener("click", loadData);
document.getElementById("cancel-session-edit").addEventListener("click", closeSessionEditor);
document.getElementById("session-start").addEventListener("input", updateSessionDurationPreview);
document.getElementById("session-end").addEventListener("input", updateSessionDurationPreview);
document.getElementById("session-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const session = selectedSession();
  if (!session) return;
  await api(`/api/sessions/${session.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      task_id: Number(document.getElementById("session-task").value),
      started_at: localInputToIso(document.getElementById("session-start").value),
      ended_at: localInputToIso(document.getElementById("session-end").value),
      notes: document.getElementById("session-notes").value,
    }),
  });
  closeSessionEditor();
  await loadData();
});
document.getElementById("delete-session").addEventListener("click", async () => {
  const session = selectedSession();
  if (!session) return;
  const confirmed = window.confirm("Delete this session?");
  if (!confirmed) return;
  await api(`/api/sessions/${session.id}`, { method: "DELETE" });
  closeSessionEditor();
  await loadData();
});

loadData();
setInterval(render, 1000);
