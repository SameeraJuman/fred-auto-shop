// appointments page: calendar and list views, status filters, and the actions on each appointment
// the record drawer is in appointment-drawer.js and the new / edit / reschedule boxes are in appointment-modals.js

import { supabase } from "../lib/supabase.js";
import { initPage } from "../shared/page.js";
import { showToast } from "../shared/toast.js";
import { confirmDialog, isConfirmOpen } from "../shared/confirm-dialog.js";
import {
    STATUS, icon, escapeHtml, statusBadge, sameDay, formatDateTime, formatTime,
    vehicleLabel, reminderLabel, isOpenStatus,
} from "./shared.js";
import {
    initAppointmentDrawer, openAppointmentDrawer, refreshAppointmentDrawer, closeAppointmentDrawer, isAppointmentDrawerOpen,
} from "./appointment-drawer.js";
import {
    initAppointmentModals, openNewAppointment, openEditAppointment, openRescheduleAppointment, isAppointmentModalOpen,
} from "./appointment-modals.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_EVENTS_PER_DAY = 3; // calendar cells show this many, then "+2 more"

// ---------- state ----------
const state = {
    appointments: [],
    view: "list",       // "list" or "calendar"
    range: "month",     // "month", "week" or "day" (day is picked by clicking a calendar day)
    cursor: startOfDay(new Date()), // any date inside the period on screen
    tab: "upcoming",    // "upcoming", "past" or "all"
    status: null,       // status filter, null shows every status
    userId: null,
};

const $ = (id) => document.getElementById(id);

// ---------- dates ----------
function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

// first and last moment of the period on screen, as [start, end)
function periodBounds() {
    const c = state.cursor;
    if (state.range === "day") return [startOfDay(c), addDays(startOfDay(c), 1)];
    if (state.range === "week") {
        const start = addDays(startOfDay(c), -c.getDay());
        return [start, addDays(start, 7)];
    }
    return [new Date(c.getFullYear(), c.getMonth(), 1), new Date(c.getFullYear(), c.getMonth() + 1, 1)];
}

function inPeriod(appointment) {
    const [start, end] = periodBounds();
    const date = new Date(appointment.appointment_datetime);
    return date >= start && date < end;
}

// ---------- loading ----------
async function loadAppointments() {
    const { data, error } = await supabase
        .from("appointments")
        .select(`
            *,
            customers ( customer_id, full_name, phone_number ),
            vehicles ( vehicle_id, customer_id, year, make, model, plate_number, colour ),
            profiles ( full_name )
        `)
        .order("appointment_datetime", { ascending: true });

    if (error) {
        console.error("Could not load appointments:", error);
        $("appointment-list").innerHTML = `
            <div class="card p-8 text-center space-y-3">
                <p class="text-sm font-semibold">Couldn't load appointments</p>
                <p class="text-xs text-muted">Check your connection and try again.</p>
                <button type="button" id="retry" class="btn btn-secondary text-xs">Retry</button>
            </div>`;
        $("retry").addEventListener("click", loadAppointments);
        return;
    }

    state.appointments = data ?? [];
    render();

    // keep the drawer in step if it's showing one of these
    refreshAppointmentDrawer(state.appointments);
}

const findAppointment = (id) => state.appointments.find((a) => a.appointment_id === id);

// ---------- actions ----------

// saves a change to one appointment, then reloads the page
async function updateAppointment(appointment, changes, message) {
    const { error } = await supabase.from("appointments").update(changes).eq("appointment_id", appointment.appointment_id);

    if (error) {
        console.error("Could not update appointment:", error);
        showToast("Couldn't save the change", "Please try again", "error");
        return false;
    }

    showToast(message, appointment.customers?.full_name ?? "");
    await loadAppointments();
    return true;
}

async function setStatus(appointment, status) {
    const copy = {
        cancelled: {
            title: "Cancel this appointment?",
            message: `${appointment.customers?.full_name ?? "The customer"} on ${formatDateTime(appointment.appointment_datetime)}.`,
            confirmLabel: "Cancel appointment",
            cancelLabel: "Keep it",
            tone: "danger",
            done: "Appointment cancelled",
        },
        missed: {
            title: "Mark as missed?",
            message: "Use this when the customer didn't turn up. It counts towards the missed appointments report.",
            confirmLabel: "Mark as missed",
            cancelLabel: "Go back",
            tone: "danger",
            done: "Marked as missed",
        },
        completed: {
            title: "Mark as completed?",
            message: "Use this once the customer has come in for the visit.",
            confirmLabel: "Mark completed",
            cancelLabel: "Go back",
            tone: "primary",
            done: "Marked as completed",
        },
    }[status];

    if (!copy) return;
    const { done, ...dialog } = copy;
    if (!(await confirmDialog(dialog))) return;

    await updateAppointment(appointment, { status }, done);
}

async function toggleReminder(appointment) {
    const enabled = appointment.reminder_enabled === false;
    await updateAppointment(appointment, { reminder_enabled: enabled }, enabled ? "Reminder turned on" : "Reminder turned off");
}

// ---------- heading counts and period ----------
function renderCounts() {
    const today = new Date();
    const [start, end] = periodBounds();
    const containsToday = today >= start && today < end;

    const open = state.appointments.filter((a) => inPeriod(a) && isOpenStatus(a.status)).length;

    let when;
    if (state.range === "day") {
        when = sameDay(state.cursor, today) ? "today" : `on ${state.cursor.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    } else if (state.range === "week") {
        when = containsToday ? "this week" : `week of ${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    } else {
        when = containsToday ? "this month" : `in ${start.toLocaleDateString("en-US", { month: "long" })}`;
    }

    $("total-count").textContent = state.appointments.length;
    $("range-count").textContent = `${open} scheduled ${when}`;
}

function renderPeriod() {
    const [start, end] = periodBounds();
    let text;

    if (state.range === "day") {
        text = state.cursor.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
    } else if (state.range === "week") {
        const last = addDays(end, -1);
        text = `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${last.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    } else {
        text = start.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }

    $("period").textContent = text;
}

// ---------- toggles, tabs and status filters ----------
function renderControls() {
    document.querySelectorAll(".view-btn").forEach((btn) => {
        const selected = btn.dataset.view === state.view;
        btn.classList.toggle("bg-accent/15", selected);
        btn.classList.toggle("text-accent", selected);
        btn.classList.toggle("text-muted", !selected);
        btn.classList.toggle("hover:text-ink", !selected);
        btn.setAttribute("aria-pressed", selected);
    });

    document.querySelectorAll(".range-btn").forEach((btn) => {
        const selected = btn.dataset.range === state.range;
        btn.classList.toggle("bg-accent", selected);
        btn.classList.toggle("text-neutral-950", selected);
        btn.classList.toggle("text-muted", !selected);
        btn.classList.toggle("hover:text-ink", !selected);
        btn.setAttribute("aria-pressed", selected);
    });

    // the underline is always there (transparent when not selected), so the tabs never shift
    document.querySelectorAll(".tab-btn").forEach((btn) => {
        const selected = btn.dataset.tab === state.tab;
        btn.classList.toggle("border-accent", selected);
        btn.classList.toggle("text-accent", selected);
        btn.classList.toggle("border-transparent", !selected);
        btn.classList.toggle("text-muted", !selected);
        btn.classList.toggle("hover:text-ink", !selected);
        btn.setAttribute("aria-pressed", selected);
    });

    $("tabs").classList.toggle("hidden", state.view !== "list");
    $("appointment-list").classList.toggle("hidden", state.view !== "list");
    $("appointment-calendar").classList.toggle("hidden", state.view !== "calendar");
}

function renderLegend() {
    // every chip keeps the same 1px border and padding whether it's selected or not,
    // only the colours change, so nothing moves when you click
    $("legend").innerHTML = Object.entries(STATUS).map(([key, info]) => {
        const selected = state.status === key;
        const look = selected ? info.chip : "bg-raised border-transparent text-ink/80 hover:text-ink hover:border-line-strong";
        return `
            <button type="button" data-status="${key}" aria-pressed="${selected}"
                class="inline-flex items-center gap-2 px-2.5 py-1 rounded-md border text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${look}">
                <span class="size-2 rounded-full ${info.dot}"></span>${info.label}
            </button>`;
    }).join("");
}

// ---------- list view ----------
function listedAppointments() {
    const now = new Date();

    const list = state.appointments.filter((a) => {
        if (!inPeriod(a)) return false;
        if (state.status && a.status !== state.status) return false;

        const upcoming = isOpenStatus(a.status) && new Date(a.appointment_datetime) >= now;
        if (state.tab === "upcoming") return upcoming;
        if (state.tab === "past") return !upcoming;
        return true;
    });

    // upcoming reads soonest first, past and all read newest first
    const direction = state.tab === "upcoming" ? 1 : -1;
    return list.sort((a, b) => direction * (new Date(a.appointment_datetime) - new Date(b.appointment_datetime)));
}

function dateBlock(appointment) {
    const date = new Date(appointment.appointment_datetime);
    const closed = !isOpenStatus(appointment.status);

    if (sameDay(date, new Date())) {
        return `<span class="text-[11px] font-bold tracking-wider text-accent">TODAY</span>`;
    }

    return `
        <span class="text-[10px] font-bold tracking-wider text-muted uppercase">${date.toLocaleDateString("en-US", { month: "short" })}</span>
        <span class="font-display text-lg font-bold leading-tight ${closed ? "text-muted" : "text-accent"}">${date.getDate()}</span>`;
}

function card(appointment) {
    const open = isOpenStatus(appointment.status);
    const reminderOn = appointment.reminder_enabled !== false;
    const name = appointment.customers?.full_name ?? "Unknown customer";

    return `
        <article data-open="${appointment.appointment_id}" tabindex="0" role="button"
            aria-label="Open appointment for ${escapeHtml(name)}"
            class="group card px-4 py-4 flex items-center gap-4 cursor-pointer hover:bg-raised hover:border-line-strong transition focus:outline-none focus-visible:border-accent">

            <!-- date -->
            <div class="w-12 shrink-0 flex flex-col items-center justify-center text-center">${dateBlock(appointment)}</div>

            <div class="min-w-0 flex-1 space-y-1.5">
                <div class="flex flex-wrap items-center gap-2">
                    <h3 class="text-sm font-bold">${escapeHtml(name)}</h3>
                    ${statusBadge(appointment.status)}
                    <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-line-strong text-[10px] font-semibold text-muted">
                        ${icon(reminderOn ? "bell" : "bellOff", "size-3")} ${reminderLabel(appointment)}
                    </span>
                </div>
                <p class="flex items-center gap-1.5 text-xs font-semibold text-accent">
                    ${icon("wrench", "size-3.5")}<span class="truncate">${escapeHtml(appointment.service_requested)}</span>
                </p>
                <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    <span>${formatDateTime(appointment.appointment_datetime)}</span>
                    <span aria-hidden="true">•</span>
                    <span class="inline-flex items-center gap-1">${icon("car", "size-3.5")}${escapeHtml(vehicleLabel(appointment.vehicles))}</span>
                </p>
            </div>

            <!-- quick actions; clicks here don't open the drawer -->
            <div class="flex items-center gap-1 shrink-0">
                <button type="button" data-action="reminder" data-id="${appointment.appointment_id}"
                    class="size-8 rounded-lg flex items-center justify-center transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed
                           ${reminderOn ? "text-accent hover:bg-accent/10" : "text-muted hover:bg-raised hover:text-ink"}"
                    title="${reminderOn ? "Turn reminder off" : "Turn reminder on"}" aria-label="${reminderOn ? "Turn reminder off" : "Turn reminder on"}"
                    aria-pressed="${reminderOn}" ${open ? "" : "disabled"}>
                    ${icon(reminderOn ? "bell" : "bellOff", "size-4")}
                </button>
                ${open ? `
                <button type="button" data-action="cancel" data-id="${appointment.appointment_id}"
                    class="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-muted hover:text-status-overdue hover:bg-status-overdue/10 transition cursor-pointer">
                    Cancel
                </button>` : ""}
                <span class="text-muted group-hover:text-ink transition">${icon("chevronRight", "size-5")}</span>
            </div>
        </article>`;
}

function renderList() {
    const list = listedAppointments();

    if (!list.length) {
        const message = state.status
            ? `No ${STATUS[state.status].label.toLowerCase()} appointments here.`
            : state.tab === "upcoming"
                ? "Nothing coming up in this period."
                : "No appointments in this period.";

        $("appointment-list").innerHTML = `
            <div class="border border-dashed border-line-strong rounded-xl p-10 text-center space-y-2">
                <p class="text-sm font-semibold">${message}</p>
                <p class="text-xs text-muted">Try another tab or period, or book a new appointment.</p>
            </div>`;
        return;
    }

    $("appointment-list").innerHTML = list.map(card).join("");
}

// ---------- calendar view ----------
function renderCalendar() {
    const [start, end] = periodBounds();

    // month view starts on the sunday before the 1st and always shows 6 weeks
    let first = start;
    let days = Math.round((end - start) / 86400000);
    if (state.range === "month") {
        first = addDays(start, -start.getDay());
        days = 42;
    }

    const today = new Date();
    const visible = state.appointments.filter((a) => !state.status || a.status === state.status);
    const tall = state.range !== "month";
    const columns = state.range === "day" ? "grid-cols-1" : "grid-cols-7";

    let html = `<div class="card overflow-hidden"><div class="grid ${columns} gap-px bg-line">`;

    if (state.range === "day") {
        html += `<div class="bg-table-head px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-muted">
            ${state.cursor.toLocaleDateString("en-US", { weekday: "long" })}</div>`;
    } else {
        html += WEEKDAYS.map((d) => `<div class="bg-table-head px-2 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-muted">${d}</div>`).join("");
    }

    for (let i = 0; i < days; i++) {
        const day = addDays(first, i);
        const outside = state.range === "month" && day.getMonth() !== state.cursor.getMonth();
        const isToday = sameDay(day, today);

        const dayAppointments = visible
            .filter((a) => sameDay(new Date(a.appointment_datetime), day))
            .sort((a, b) => new Date(a.appointment_datetime) - new Date(b.appointment_datetime));

        const limit = tall ? dayAppointments.length : MAX_EVENTS_PER_DAY;
        const shown = dayAppointments.slice(0, limit);
        const extra = dayAppointments.length - shown.length;

        html += `
            <div data-day="${day.toLocaleDateString("en-CA")}" tabindex="0" role="button"
                aria-label="Show ${day.toLocaleDateString("en-US", { month: "long", day: "numeric" })}"
                class="${tall ? "min-h-64" : "min-h-28"} p-2 flex flex-col gap-1 cursor-pointer transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent
                       ${isToday ? "bg-accent/5 hover:bg-accent/10" : "bg-surface hover:bg-raised"} ${outside ? "opacity-40" : ""}">
                <span class="size-6 rounded-full flex items-center justify-center text-xs font-semibold
                    ${isToday ? "bg-accent text-neutral-950" : "text-ink"}">${day.getDate()}</span>
                ${shown.map((a) => `
                    <button type="button" data-open="${a.appointment_id}"
                        class="w-full text-left truncate rounded px-1.5 py-1 text-[10px] font-semibold cursor-pointer hover:brightness-125 ${STATUS[a.status]?.badge ?? "bg-raised text-muted"}">
                        ${formatTime(a.appointment_datetime)} · ${escapeHtml(a.customers?.full_name ?? "Appointment")}
                    </button>`).join("")}
                ${extra > 0 ? `<span class="px-1.5 text-[10px] font-semibold text-muted">+${extra} more</span>` : ""}
            </div>`;
    }

    html += "</div></div>";
    $("appointment-calendar").innerHTML = html;
}

// ---------- page ----------
function render() {
    renderCounts();
    renderPeriod();
    renderControls();
    renderLegend();
    if (state.view === "list") renderList();
    else renderCalendar();
}

function movePeriod(step) {
    const c = state.cursor;
    if (state.range === "day") state.cursor = addDays(c, step);
    else if (state.range === "week") state.cursor = addDays(c, step * 7);
    else state.cursor = new Date(c.getFullYear(), c.getMonth() + step, 1);
    render();
}

// clicking a day in the calendar lists just that day
function showDay(isoDate) {
    const [y, m, d] = isoDate.split("-").map(Number);
    state.cursor = new Date(y, m - 1, d);
    state.range = "day";
    state.view = "list";
    state.tab = "all";
    render();
}

function openDrawer(id) {
    const appointment = findAppointment(id);
    if (appointment) openAppointmentDrawer(appointment);
}

function setupEvents() {
    $("new-appointment").addEventListener("click", () => openNewAppointment());

    document.querySelectorAll(".view-btn").forEach((btn) =>
        btn.addEventListener("click", () => {
            state.view = btn.dataset.view;
            // the calendar has no single-day grid worth showing, so go back to the week
            if (state.view === "calendar" && state.range === "day") state.range = "week";
            render();
        }),
    );

    document.querySelectorAll(".range-btn").forEach((btn) =>
        btn.addEventListener("click", () => {
            state.range = btn.dataset.range;
            render();
        }),
    );

    document.querySelectorAll(".tab-btn").forEach((btn) =>
        btn.addEventListener("click", () => {
            state.tab = btn.dataset.tab;
            render();
        }),
    );

    $("today").addEventListener("click", () => {
        state.cursor = startOfDay(new Date());
        render();
    });
    $("previous").addEventListener("click", () => movePeriod(-1));
    $("next").addEventListener("click", () => movePeriod(1));

    $("legend").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-status]");
        if (!btn) return;
        state.status = state.status === btn.dataset.status ? null : btn.dataset.status;
        render();
    });

    // list: the quick action buttons first, otherwise the card opens the drawer
    $("appointment-list").addEventListener("click", async (e) => {
        const action = e.target.closest("[data-action]");
        if (action) {
            e.stopPropagation();
            const appointment = findAppointment(action.dataset.id);
            if (!appointment || action.disabled) return;
            action.disabled = true;
            if (action.dataset.action === "reminder") await toggleReminder(appointment);
            if (action.dataset.action === "cancel") await setStatus(appointment, "cancelled");
            action.disabled = false;
            return;
        }
        const cardEl = e.target.closest("[data-open]");
        if (cardEl) openDrawer(cardEl.dataset.open);
    });

    // calendar: an appointment opens the drawer, anywhere else in the cell lists that day
    $("appointment-calendar").addEventListener("click", (e) => {
        const event = e.target.closest("[data-open]");
        if (event) return openDrawer(event.dataset.open);
        const day = e.target.closest("[data-day]");
        if (day) showDay(day.dataset.day);
    });

    // enter or space on a focused card or calendar day
    document.querySelector("main").addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const target = e.target;
        if (target.matches("article[data-open]")) {
            e.preventDefault();
            openDrawer(target.dataset.open);
        } else if (target.matches("[data-day]")) {
            e.preventDefault();
            showDay(target.dataset.day);
        }
    });
}

// links from other pages:
//   ?appointment=<id>                opens that appointment (dashboard)
//   ?new=1&customer=<id>             opens the new appointment box for that customer (customer details)
function handleLinks() {
    const params = new URLSearchParams(window.location.search);

    const id = params.get("appointment");
    const linked = id && findAppointment(id);
    if (linked) {
        state.cursor = startOfDay(new Date(linked.appointment_datetime));
        state.tab = "all";
        render();
        openAppointmentDrawer(linked);
    }

    if (["1", "true"].includes(params.get("new"))) {
        openNewAppointment({ customerId: params.get("customer") });
    }

    // tidy the address bar so a refresh doesn't open things again
    if (params.size) history.replaceState(null, "", window.location.pathname);
}

async function init() {
    const session = await initPage({ active: "appointments" });
    if (!session) return;
    state.userId = session.user.id;

    initAppointmentDrawer({
        onStatus: setStatus,
        onEdit: (a) => openEditAppointment(a),
        onReschedule: (a) => openRescheduleAppointment(a),
        // escape closes the box on top first, not the drawer behind it
        isCovered: () => isAppointmentModalOpen() || isConfirmOpen(),
    });

    initAppointmentModals({
        userId: state.userId,
        getAppointments: () => state.appointments,
        onSaved: async ({ appointmentId, closeDrawer }) => {
            if (closeDrawer && isAppointmentDrawerOpen()) closeAppointmentDrawer();
            await loadAppointments();
            // jump to the saved appointment's period so it's on screen
            const saved = appointmentId && findAppointment(appointmentId);
            if (saved && !inPeriod(saved)) {
                state.cursor = startOfDay(new Date(saved.appointment_datetime));
                render();
            }
        },
    });

    setupEvents();
    render();
    await loadAppointments();
    handleLinks();
}

init();
