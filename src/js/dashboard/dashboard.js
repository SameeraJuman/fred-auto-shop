// home dashboard for staff (pages/dashboard.html) and admins (pages/admin/index.html)
// both pages run this file; the admin page has data-admin-page on <body> and also shows parts alerts
// new jobs and job details reuse the jobs page's modal and drawer, so they work the same everywhere

import { supabase } from "../lib/supabase.js";
import { initPage } from "../shared/page.js";
import { matchesShortcut, shortcutLabel, shortcutAria } from "../shared/shortcuts.js";
import { initNewJobModal, openNewJobModal } from "../jobs/new-job-modal.js";
import { initJobDrawer, openJobDrawer, isJobDrawerOpen } from "../jobs/job-drawer.js";
import { initQuickAddModal, openQuickAddModal, isQuickAddOpen } from "./quick-add-modal.js";

const isAdminPage = document.body.hasAttribute("data-admin-page");

// label and pill class for each job and appointment status (keys match the enums in the database)
// class names are written out in full so tailwind can find them
const statuses = {
    not_started:      { label: "Not Started",      pill: "status-not-started" },
    in_progress:      { label: "In Progress",      pill: "status-in-progress" },
    awaiting_parts:   { label: "Awaiting Parts",   pill: "status-awaiting-parts" },
    overdue:          { label: "Overdue",          pill: "status-overdue" },
    ready_for_pickup: { label: "Ready for Pickup", pill: "status-ready" },
    delivered:        { label: "Delivered",        pill: "status-delivered" },
    scheduled:        { label: "Scheduled",        pill: "status-in-progress" },
    completed:        { label: "Completed",        pill: "status-delivered" },
    rescheduled:      { label: "Rescheduled",      pill: "status-awaiting-parts" },
    cancelled:        { label: "Cancelled",        pill: "status-not-started" },
    missed:           { label: "Missed",           pill: "status-overdue" },
};

// appointments that are finished one way or another
const CLOSED_APPOINTMENTS = ["completed", "cancelled", "missed"];

const RECENT_JOBS = 8; // rows in the recent jobs table

const ICONS = {
    chevronRight: "M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z",
    warning: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
    key: "M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z",
    box: "M20 2H4c-1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.69V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 2-2V8.7c.57-.35 1-.97 1-1.69V4c0-1.1-1-2-2-2zm-5 12H9v-2h6v2zm5-7H4V4l16-.02V7z",
};

function icon(name, size = "size-5") {
    return `<svg class="${size} shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
}

// text from the database gets escaped before it goes into html
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text ?? "";
    return div.innerHTML;
}

// ---------- small helpers ----------

// today as yyyy-mm-dd in local time (expected_completion_date is stored the same way)
const todayIso = () => new Date().toLocaleDateString("en-CA");

// e.g. 2:30 pm
const formatTime = (value) => new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

// e.g. 5 mins ago
function relativeTime(value) {
    if (!value) return "—";
    const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
    if (seconds < 60) return "Just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} mins ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
}

const vehicleName = (v) => (v ? `${v.year} ${v.make} ${v.model}` : "Vehicle not specified");

const plateBadge = (v) => (v?.plate_number ? `<span class="plate">${escapeHtml(v.plate_number)}</span>` : "");

function pill(status) {
    const s = statuses[status] ?? { label: status, pill: "status-not-started" };
    return `<span class="pill ${s.pill}"><span class="size-1.5 rounded-full bg-current"></span>${escapeHtml(s.label)}</span>`;
}

const emptyCard = (text) => `<p class="card p-6 text-center text-sm text-muted">${text}</p>`;

// overdue if it's marked overdue, or the expected date has passed and it isn't finished
function isOverdue(job) {
    if (job.status === "overdue") return true;
    if (["delivered", "ready_for_pickup"].includes(job.status)) return false;
    return Boolean(job.expected_completion_date && job.expected_completion_date < todayIso());
}

// ---------- state ----------
let jobs = [];
let appointments = []; // today's only
let parts = [];        // admin page only
let searchTerm = "";
let appointmentFilter = "all"; // 'all', 'pending' or 'done'

const $ = (id) => document.getElementById(id);

// ---------- loading from supabase ----------

function showError(text) {
    $("dashboard-error").textContent = text;
    $("dashboard-error").classList.toggle("hidden", !text);
}

async function loadJobs() {
    const { data, error } = await supabase
        .from("jobs")
        .select(`
            job_id,
            problem_description,
            status,
            expected_completion_date,
            updated_at,
            customers ( full_name ),
            vehicles ( make, model, year, plate_number )
        `)
        .order("updated_at", { ascending: false });

    if (error) throw error;
    jobs = data;
}

// only today's appointments, from local midnight to the next midnight
async function loadAppointments() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const { data, error } = await supabase
        .from("appointments")
        .select(`
            appointment_id,
            service_requested,
            appointment_datetime,
            status,
            customers ( full_name ),
            vehicles ( make, model, year, plate_number )
        `)
        .gte("appointment_datetime", start.toISOString())
        .lt("appointment_datetime", end.toISOString())
        .order("appointment_datetime");

    if (error) throw error;
    appointments = data;
}

// the view only returns rows for admins
async function loadParts() {
    const { data, error } = await supabase
        .from("v_restock_alerts")
        .select("part_id, part_name, alert_threshold, alert_period_days, used_in_period");

    if (error) throw error;
    parts = data;
}

// loads everything; one part failing doesn't stop the others from showing
async function refresh() {
    const loaders = [loadJobs(), loadAppointments()];
    if (isAdminPage) loaders.push(loadParts());

    const results = await Promise.allSettled(loaders);
    const failed = results.filter((r) => r.status === "rejected");

    failed.forEach((r) => console.error("Dashboard load error:", r.reason));
    showError(failed.length ? "Some dashboard data couldn't load. Refresh the page to try again." : "");

    render();
}

// ---------- search ----------

function matchesSearch(row) {
    const text = [
        row.customers?.full_name,
        row.problem_description,
        row.service_requested,
        vehicleName(row.vehicles),
        row.vehicles?.plate_number,
    ].join(" ").toLowerCase();
    return text.includes(searchTerm);
}

// ---------- summary cards ----------
function renderSummary() {
    $("active-count").textContent = jobs.filter((j) => j.status !== "delivered").length;
    $("overdue-count").textContent = jobs.filter(isOverdue).length;
    $("appointment-count").textContent = appointments.length;
    if (isAdminPage) $("parts-count").textContent = parts.length;

    const next = appointments.find(
        (a) => new Date(a.appointment_datetime) > new Date() && !CLOSED_APPOINTMENTS.includes(a.status),
    );
    $("next-appointment").textContent = next ? `Next at ${formatTime(next.appointment_datetime)}` : "None coming up";
}

// ---------- today's appointments ----------
function renderAppointments() {
    // filter buttons
    document.querySelectorAll(".appt-filter").forEach((btn) => {
        const selected = btn.dataset.apptFilter === appointmentFilter;
        btn.className = "appt-filter px-3 py-1 rounded-md transition " +
            (selected ? "bg-accent text-neutral-950" : "text-muted hover:text-ink");
    });

    const list = appointments.filter(matchesSearch).filter((a) => {
        if (appointmentFilter === "pending") return !CLOSED_APPOINTMENTS.includes(a.status);
        if (appointmentFilter === "done") return a.status === "completed";
        return true;
    });

    $("appointment-badge").textContent = list.length;
    $("appointments-list").innerHTML = list.length
        ? list.map((a) => `
            <a href="/pages/appointments.html?appointment=${a.appointment_id}"
                class="group card p-3 flex items-center gap-3 hover:bg-raised hover:border-line-strong transition">
                <span class="w-20 shrink-0 rounded-lg bg-raised py-2 text-center font-mono text-xs font-bold tabular-nums">
                    ${formatTime(a.appointment_datetime)}
                </span>
                <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="text-sm font-semibold">${escapeHtml(a.customers?.full_name ?? "Unknown customer")}</span>
                        ${pill(a.status)}
                    </div>
                    <p class="mt-1 text-xs text-muted truncate">${escapeHtml(a.service_requested)}</p>
                    <p class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">${escapeHtml(vehicleName(a.vehicles))} ${plateBadge(a.vehicles)}</p>
                </div>
                <span class="text-muted group-hover:text-ink">${icon("chevronRight")}</span>
            </a>`).join("")
        : emptyCard("No appointments to show.");
}

// ---------- needs attention: overdue and ready for pickup ----------
function renderAttention() {
    const list = jobs
        .filter((j) => isOverdue(j) || j.status === "ready_for_pickup")
        .filter(matchesSearch);

    $("attention-badge").textContent = list.length;
    $("attention-list").innerHTML = list.length
        ? list.map((j) => {
            const overdue = isOverdue(j);
            const tile = overdue
                ? "bg-status-overdue/10 text-status-overdue"
                : "bg-status-ready/10 text-status-ready";
            return `
            <button type="button" data-job="${j.job_id}"
                class="group card p-3 w-full text-left flex items-center gap-3 hover:bg-raised hover:border-line-strong transition cursor-pointer">
                <span class="size-10 shrink-0 rounded-lg flex items-center justify-center ${tile}">
                    ${icon(overdue ? "warning" : "key")}
                </span>
                <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="text-sm font-semibold">${escapeHtml(j.customers?.full_name ?? "Unknown customer")}</span>
                        ${pill(overdue ? "overdue" : j.status)}
                    </div>
                    <p class="mt-1 text-xs text-muted truncate">${escapeHtml(j.problem_description)}</p>
                    <p class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">${escapeHtml(vehicleName(j.vehicles))} ${plateBadge(j.vehicles)}</p>
                </div>
                <span class="text-muted group-hover:text-ink">${icon("chevronRight")}</span>
            </button>`;
        }).join("")
        : emptyCard("Nothing needs attention right now.");
}

// ---------- parts alerts (admin page) ----------
function renderParts() {
    const list = parts.filter((p) => p.part_name.toLowerCase().includes(searchTerm));

    $("parts-badge").textContent = list.length;
    $("parts-list").innerHTML = list.length
        ? list.map((p) => `
            <a href="/pages/admin/parts.html"
                class="group card p-3 flex items-center gap-3 hover:bg-raised hover:border-line-strong transition">
                <span class="size-10 shrink-0 rounded-lg flex items-center justify-center bg-status-awaiting-parts/10 text-status-awaiting-parts">
                    ${icon("box")}
                </span>
                <div class="min-w-0 flex-1">
                    <span class="text-sm font-semibold">${escapeHtml(p.part_name)}</span>
                    <p class="mt-1 text-xs text-muted">
                        Used ${p.used_in_period} times in ${p.alert_period_days} days (limit ${p.alert_threshold})
                    </p>
                </div>
                <span class="text-muted group-hover:text-ink">${icon("chevronRight")}</span>
            </a>`).join("")
        : emptyCard("No parts usage alerts.");
}

// ---------- recent jobs ----------
function renderRecentJobs() {
    const list = jobs.filter(matchesSearch).slice(0, RECENT_JOBS);

    $("recent-jobs-body").innerHTML = list.length
        ? list.map((j) => `
            <tr data-job="${j.job_id}" tabindex="0" class="group odd:bg-row even:bg-row-alt hover:bg-raised/60 cursor-pointer transition">
                <td class="px-5 py-4">
                    <p class="text-sm leading-snug line-clamp-2">${escapeHtml(j.problem_description)}</p>
                </td>
                <td class="px-5 py-4">
                    <p class="text-sm font-semibold">${escapeHtml(j.customers?.full_name ?? "Unknown customer")}</p>
                    <p class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">${escapeHtml(vehicleName(j.vehicles))} ${plateBadge(j.vehicles)}</p>
                </td>
                <td class="px-5 py-4 text-center">${pill(j.status)}</td>
                <td class="px-5 py-4 text-sm text-muted whitespace-nowrap">${relativeTime(j.updated_at)}</td>
                <td class="px-5 py-4 text-muted group-hover:text-ink">${icon("chevronRight", "size-4")}</td>
            </tr>`).join("")
        : `<tr><td colspan="5" class="p-8 text-center text-muted">No jobs to show.</td></tr>`;
}

// ---------- draw everything ----------
function render() {
    renderSummary();
    renderAppointments();
    renderAttention();
    renderRecentJobs();
    if (isAdminPage) renderParts();
}

// ---------- events ----------
function setupEvents() {
    // search box filters every list on the page
    $("dashboard-search").addEventListener("input", (e) => {
        searchTerm = e.target.value.trim().toLowerCase();
        render();
    });

    // ctrl+k jumps to the search box (cmd+k on a mac)
    document.querySelector("[data-shortcut-label]").textContent = shortcutLabel("k");
    $("dashboard-search").setAttribute("aria-keyshortcuts", shortcutAria("k"));
    document.addEventListener("keydown", (e) => {
        if (!matchesShortcut(e, "k")) return;
        if (isJobDrawerOpen() || isQuickAddOpen()) return;
        e.preventDefault();
        $("dashboard-search").focus();
    });

    // appointment filter buttons
    document.querySelectorAll(".appt-filter").forEach((btn) =>
        btn.addEventListener("click", () => {
            appointmentFilter = btn.dataset.apptFilter;
            renderAppointments();
        }),
    );

    // quick action buttons
    document.querySelectorAll("[data-open]").forEach((btn) =>
        btn.addEventListener("click", () => {
            if (btn.dataset.open === "job") openNewJobModal();
            else openQuickAddModal(btn.dataset.open);
        }),
    );

    // summary cards scroll to their section
    document.querySelectorAll("[data-scroll]").forEach((card) =>
        card.addEventListener("click", () => {
            $(card.dataset.scroll).scrollIntoView({ behavior: "smooth", block: "start" });
        }),
    );

    // any job (needs attention or recent jobs) opens the job details drawer
    document.querySelector("main").addEventListener("click", (e) => {
        const job = e.target.closest("[data-job]");
        if (job) openJobDrawer(job.dataset.job);
    });

    // enter or space on a focused table row opens it too
    $("recent-jobs-body").addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const row = e.target.closest("[data-job]");
        if (!row) return;
        e.preventDefault();
        openJobDrawer(row.dataset.job);
    });
}

// ---------- start ----------
async function main() {
    // checks the login, loads the profile and draws the sidebar
    const page = await initPage({ active: "dashboard", adminOnly: isAdminPage });
    if (!page) return;

    // greeting with the user's first name
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const firstName = (page.profile.full_name || "there").trim().split(/\s+/)[0];
    $("greeting").textContent = `${greeting}, ${firstName}`;

    // the same new job modal and job drawer as the jobs page; reload the dashboard after changes
    initNewJobModal({ userId: page.user.id, onCreated: refresh });
    initJobDrawer({ userId: page.user.id, isAdmin: page.profile.role === "admin", onSaved: refresh });
    initQuickAddModal({ userId: page.user.id, onCreated: refresh });

    setupEvents();
    await refresh();
}

main();