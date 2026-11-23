// helpers shared by the appointments page, the appointment drawer and the appointment modals

// label and colours for each appointment status (keys match the appointment_status enum)
// class names are written out in full so tailwind can find them
export const STATUS = {
    scheduled: {
        label: "Scheduled",
        dot: "bg-status-in-progress",
        text: "text-status-in-progress",
        badge: "bg-status-in-progress/15 text-status-in-progress",
        chip: "bg-status-in-progress/10 border-status-in-progress/60 text-status-in-progress",
    },
    completed: {
        label: "Completed",
        dot: "bg-status-delivered",
        text: "text-status-delivered",
        badge: "bg-status-delivered/15 text-status-delivered",
        chip: "bg-status-delivered/10 border-status-delivered/60 text-status-delivered",
    },
    rescheduled: {
        label: "Rescheduled",
        dot: "bg-status-awaiting-parts",
        text: "text-status-awaiting-parts",
        badge: "bg-status-awaiting-parts/15 text-status-awaiting-parts",
        chip: "bg-status-awaiting-parts/10 border-status-awaiting-parts/60 text-status-awaiting-parts",
    },
    cancelled: {
        label: "Cancelled",
        dot: "bg-status-not-started",
        text: "text-status-not-started",
        badge: "bg-status-not-started/15 text-status-not-started",
        chip: "bg-status-not-started/10 border-status-not-started/60 text-status-not-started",
    },
    missed: {
        label: "Missed",
        dot: "bg-status-overdue",
        text: "text-status-overdue",
        badge: "bg-status-overdue/15 text-status-overdue",
        chip: "bg-status-overdue/10 border-status-overdue/60 text-status-overdue",
    },
};

// appointments that are still going to happen
export const OPEN_STATUSES = ["scheduled", "rescheduled"];
export const isOpenStatus = (status) => OPEN_STATUSES.includes(status);

// reminder choices, "off" turns the reminder off but keeps the lead time
export const REMINDER_OPTIONS = [
    { value: "off", label: "Off" },
    { value: "15", label: "15 min before" },
    { value: "30", label: "30 min before" },
    { value: "60", label: "1 hr before" },
    { value: "120", label: "2 hrs before" },
    { value: "1440", label: "1 day before" },
];

// two appointments closer than this are flagged as overlapping
export const OVERLAP_MINUTES = 60;

// material icon paths, drawn as inline svg like the rest of the app
export const ICONS = {
    add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
    addCircle: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z",
    calendar: "M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z",
    calendarMonth: "M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM9 14H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2zm-8 4H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2z",
    eventDone: "M16.53 11.06L15.47 10l-4.88 4.88-2.12-2.12-1.06 1.06L10.59 17l5.94-5.94zM19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z",
    eventBusy: "M9.31 17l2.44-2.44L14.19 17l1.06-1.06-2.44-2.44 2.44-2.44-1.06-1.06-2.44 2.44-2.44-2.44-1.06 1.06 2.44 2.44-2.44 2.44L9.31 17zM19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z",
    reschedule: "M21 10.12h-6.78l2.74-2.82c-2.73-2.7-7.15-2.8-9.88-.1-2.73 2.71-2.73 7.08 0 9.79s7.15 2.71 9.88 0C18.32 15.65 19 14.08 19 12.1h2c0 1.98-.88 4.55-2.64 6.29-3.51 3.48-9.21 3.48-12.72 0-3.5-3.47-3.53-9.11-.02-12.58s9.14-3.47 12.65 0L21 3v7.12zM12.5 8v4.25l3.5 2.08-.72 1.21L11 13V8h1.5z",
    list: "M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z",
    chevronLeft: "M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z",
    chevronRight: "M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z",
    close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
    bell: "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z",
    bellOff: "M20 18.69L7.84 6.14 5.27 3.49 4 4.76l2.8 2.8v.01c-.52.99-.8 2.16-.8 3.42v5l-2 2v1h13.73l2 2L21 19.72l-1-1.03zM12 22c1.11 0 2-.89 2-2h-4c0 1.11.89 2 2 2zm6-7.32V11c0-3.08-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68c-.15.03-.29.08-.42.12-.1.03-.2.07-.3.11h-.01c-.01 0-.01 0-.02.01-.23.09-.46.2-.68.31 0 0-.01 0-.01.01L18 14.68z",
    wrench: "M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z",
    car: "M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z",
    phone: "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z",
    personAdd: "M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
    lock: "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z",
    edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
    check: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
    clock: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
    warning: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
    info: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z",
    cancel: "M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z",
};

export function icon(name, size = "size-4") {
    return `<svg class="${size} shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
}

// text from the database gets escaped before it goes into html
export function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text ?? "";
    return div.innerHTML;
}

// small coloured status badge, e.g. SCHEDULED
export function statusBadge(status) {
    const info = STATUS[status] ?? { label: status, badge: "bg-raised text-muted" };
    return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${info.badge}">${escapeHtml(info.label)}</span>`;
}

// ---------- dates ----------

// e.g. Oct 12, 2026
export const formatDate = (value) =>
    new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// e.g. 02:00 PM
export const formatTime = (value) =>
    new Date(value).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

// e.g. Oct 12, 2026 • 02:00 PM
export const formatDateTime = (value) => `${formatDate(value)} • ${formatTime(value)}`;

export function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// yyyy-mm-ddThh:mm in local time, for datetime-local inputs
export function toLocalInput(date) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

// a datetime-local value back into a date, or null if it's empty or not valid
export function fromLocalInput(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

// ---------- records ----------

// short readable reference from the uuid, e.g. APT-2026-3F9A
export const referenceId = (appointment) =>
    `APT-${new Date(appointment.appointment_datetime).getFullYear()}-${appointment.appointment_id.replace(/-/g, "").slice(-4).toUpperCase()}`;

export function vehicleName(vehicle) {
    if (!vehicle) return "";
    return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ");
}

// e.g. 2015 Dodge Ram 1500 (RAM-8924), or "Vehicle: Not sure yet"
export function vehicleLabel(vehicle) {
    if (!vehicle) return "Vehicle: Not sure yet";
    return vehicle.plate_number ? `${vehicleName(vehicle)} (${vehicle.plate_number})` : vehicleName(vehicle);
}

export function reminderLabel(appointment) {
    if (appointment.reminder_enabled === false) return "Off";
    const minutes = String(appointment.reminder_lead_minutes ?? 60);
    return REMINDER_OPTIONS.find((o) => o.value === minutes)?.label ?? `${minutes} min before`;
}

// the reminder select's value for an appointment
export const reminderValue = (appointment) =>
    appointment?.reminder_enabled === false ? "off" : String(appointment?.reminder_lead_minutes ?? 60);

// turns the reminder select's value back into columns
export function reminderColumns(value, current = null) {
    if (value === "off") {
        return { reminder_enabled: false, reminder_lead_minutes: current?.reminder_lead_minutes ?? 60 };
    }
    return { reminder_enabled: true, reminder_lead_minutes: Number(value) };
}

export const reminderOptionsHtml = (selected) =>
    REMINDER_OPTIONS.map((o) => `<option value="${o.value}" ${o.value === selected ? "selected" : ""}>${o.label}</option>`).join("");

// first open appointment within OVERLAP_MINUTES of the given time, ignoring one appointment (the one being moved)
export function findOverlap(appointments, date, ignoreId = null) {
    const gap = OVERLAP_MINUTES * 60 * 1000;
    return appointments.find(
        (a) =>
            a.appointment_id !== ignoreId &&
            isOpenStatus(a.status) &&
            Math.abs(new Date(a.appointment_datetime).getTime() - date.getTime()) < gap,
    ) ?? null;
}

// initials for the "booked by" line, e.g. KO
export const initials = (name) =>
    (name ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join("") || "?";
