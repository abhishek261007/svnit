const loginView = document.querySelector("#login-view");
const dashboardView = document.querySelector("#dashboard-view");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const appError = document.querySelector("#app-error");
const summaryGrid = document.querySelector("#summary-grid");
const historySection = document.querySelector("#history-section");
const historyRows = document.querySelector("#history-rows");
const dateFrom = document.querySelector("#date-from");
const dateTo = document.querySelector("#date-to");
let attendanceEntries = [];

async function api(path, body = {}) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function showDashboard(user) {
  loginView.classList.add("hidden");
  dashboardView.classList.remove("hidden");
  document.querySelector("#user-name").textContent = user.name || "Student";
  document.querySelector("#student-meta").textContent = [user.regNo, user.uaType ? `MIS account type ${user.uaType}` : ""].filter(Boolean).join(" · ") || "Your MIS attendance data";
  loadSummary();
}

function showError(error) {
  appError.textContent = error.message || "Unable to load attendance.";
  appError.classList.remove("hidden");
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPercent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(1).replace(/\.0$/, "")}%` : "—";
}

function classesToTarget(present, total, target = 75) {
  if (!total || present / total >= target / 100) return 0;
  return Math.max(0, Math.ceil((target * total - 100 * present) / (100 - target)));
}

function renderSummary(data) {
  const items = Array.isArray(data.AttendanceDetails) ? data.AttendanceDetails : [];
  summaryGrid.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "loading-card";
    empty.textContent = data.Message || "No attendance summary was returned by MIS.";
    summaryGrid.append(empty);
    document.querySelector("#overall-value").textContent = "—";
    document.querySelector("#overall-detail").textContent = "No attendance records";
    return;
  }

  let totalPresent = 0;
  let totalClasses = 0;
  for (const item of items) {
    const present = num(item.Present);
    const absent = num(item.Absent);
    const total = num(item.Total_Class ?? item.TotalClass) || present + absent;
    totalPresent += present;
    totalClasses += total;
    const percentage = Number(item.Percentage ?? (total ? present / total * 100 : NaN));
    const belowTarget = Number.isFinite(percentage) && percentage < 75;
    const needed = classesToTarget(present, total);
    const card = document.createElement("button");
    card.type = "button";
    card.className = `summary-card${belowTarget ? " below-target" : ""}`;
    const code = document.createElement("div");
    code.className = "course-code";
    code.textContent = String(item.CourseNo ?? "COURSE");
    const name = document.createElement("div");
    name.className = "course-name";
    name.textContent = String(item.Course_Name ?? item.CourseName ?? "Course attendance");
    const bottom = document.createElement("div");
    bottom.className = "card-bottom";
    const pct = document.createElement("strong");
    pct.className = `percent${belowTarget ? " below-target-text" : ""}`;
    pct.textContent = formatPercent(percentage);
    const stats = document.createElement("span");
    stats.className = "stats";
    stats.textContent = `${present} present · ${absent} absent\n${total} classes held${belowTarget ? `\n${needed} more present class${needed === 1 ? "" : "es"} to reach 75%` : ""}`;
    bottom.append(pct, stats);
    const progress = document.createElement("progress");
    progress.className = "progress-meter";
    progress.max = 100;
    progress.value = Math.max(0, Math.min(100, Number.isFinite(percentage) ? percentage : 0));
    card.append(code, name, bottom, progress);
    card.addEventListener("click", () => loadHistory(String(item.CourseNo ?? ""), String(item.Course_Name ?? item.CourseName ?? "Course attendance")));
    summaryGrid.append(card);
  }
  const overallPercent = totalClasses ? totalPresent / totalClasses * 100 : NaN;
  const overallBelowTarget = Number.isFinite(overallPercent) && overallPercent < 75;
  const overallValue = document.querySelector("#overall-value");
  overallValue.textContent = totalClasses ? formatPercent(overallPercent) : "—";
  overallValue.classList.toggle("below-target-text", overallBelowTarget);
  const overallNeeded = classesToTarget(totalPresent, totalClasses);
  document.querySelector("#overall-detail").textContent = `${totalPresent} present of ${totalClasses} classes${overallBelowTarget ? ` · ${overallNeeded} more present to reach 75%` : ""}`;
}

async function loadSummary() {
  appError.classList.add("hidden");
  summaryGrid.innerHTML = '<div class="loading-card">Loading your attendance…</div>';
  try {
    const data = await api("/api/attendance/summary");
    renderSummary(data);
  } catch (error) {
    showError(error);
    summaryGrid.replaceChildren();
  }
}

async function loadHistory(courseNo, courseName) {
  if (!courseNo) return;
  appError.classList.add("hidden");
  historySection.classList.remove("hidden");
  historySection.scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelector("#history-title").textContent = courseName;
  document.querySelector("#history-meta").textContent = "Loading class-by-class records…";
  historyRows.replaceChildren();
  try {
    const data = await api("/api/attendance/subject", { courseNo });
    attendanceEntries = Array.isArray(data.AttendanceBySubject) ? data.AttendanceBySubject : [];
    const student = data.StudInfo || {};
    document.querySelector("#history-meta").textContent = [student.StudentName, student.Branch, student.Semester].filter(Boolean).join(" · ") || `${attendanceEntries.length} attendance entries`;
    renderHistory();
  } catch (error) {
    attendanceEntries = [];
    document.querySelector("#history-meta").textContent = "Could not load this subject.";
    showError(error);
  }
}

function parseDate(value) {
  const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(value.trim());
  if (match) {
    const [, day, month, year] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function renderHistory() {
  const start = dateFrom.value ? new Date(`${dateFrom.value}T00:00:00`) : null;
  const end = dateTo.value ? new Date(`${dateTo.value}T23:59:59`) : null;
  const entries = [...attendanceEntries].filter((entry) => {
    const date = parseDate(String(entry.AttDate ?? ""));
    if (!date) return true;
    return (!start || date >= start) && (!end || date <= end);
  }).sort((a, b) => (parseDate(String(b.AttDate ?? ""))?.getTime() ?? 0) - (parseDate(String(a.AttDate ?? ""))?.getTime() ?? 0));
  historyRows.replaceChildren();
  for (const entry of entries) {
    const row = document.createElement("tr");
    const date = document.createElement("td");
    date.textContent = String(entry.AttDate ?? "—");
    const period = document.createElement("td");
    period.textContent = String(entry.Period ?? "—");
    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    const rawStatus = String(entry.AttStatus ?? "");
    const present = rawStatus === "1";
    const absent = rawStatus === "0";
    status.className = `status ${present ? "present" : absent ? "absent" : "other"}`;
    status.textContent = present ? "Present" : absent ? "Absent" : rawStatus || "—";
    statusCell.append(status);
    row.append(date, period, statusCell);
    historyRows.append(row);
  }
  document.querySelector("#history-empty").classList.toggle("hidden", entries.length > 0);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const button = loginForm.querySelector("button");
  button.disabled = true;
  button.textContent = "Signing in…";
  try {
    const username = document.querySelector("#username").value.trim();
    const passwordInput = document.querySelector("#password");
    const user = await api("/api/login", { username, password: passwordInput.value });
    passwordInput.value = "";
    showDashboard(user.user);
  } catch (error) {
    loginError.textContent = error.message || "Sign in failed.";
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
  }
});

document.querySelector("#refresh-button").addEventListener("click", loadSummary);
document.querySelector("#close-history").addEventListener("click", () => historySection.classList.add("hidden"));
document.querySelector("#clear-dates").addEventListener("click", () => { dateFrom.value = ""; dateTo.value = ""; renderHistory(); });
dateFrom.addEventListener("change", renderHistory);
dateTo.addEventListener("change", renderHistory);
fetch("/api/session", { credentials: "same-origin" }).then(async (response) => {
  if (!response.ok) return;
  const data = await response.json();
  if (data.user) showDashboard(data.user);
}).catch(() => {});
document.querySelector("#logout-button").addEventListener("click", async () => {
  try { await api("/api/logout"); } catch { /* clear local view even if the server is already gone */ }
  dashboardView.classList.add("hidden");
  loginView.classList.remove("hidden");
  historySection.classList.add("hidden");
  document.querySelector("#password").value = "";
  document.querySelector("#overall-value").textContent = "—";
  summaryGrid.replaceChildren();
});
