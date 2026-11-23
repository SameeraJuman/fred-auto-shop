// appointment record drawer that slides in from the right side of the appointments page
// shows the appointment and its customer and vehicle, with edit, reschedule and status actions
// usage:
//   import { initAppointmentDrawer, openAppointmentDrawer } from "./appointment-drawer.js";
//   initAppointmentDrawer({ onStatus, onEdit, onReschedule, isCovered });
//   openAppointmentDrawer(appointment);

import {
    icon, escapeHtml, statusBadge, formatDateTime, referenceId, vehicleName, reminderLabel, isOpenStatus, initials,
} from "./shared.js";

let options = { onStatus: () => {}, onEdit: () => {}, onReschedule: () => {}, isCovered: () => false };
let current = null; // the appointment on screen
let isOpen = false;
let lastFocused = null;

const $ = (id) => document.getElementById(id);

export const isAppointmentDrawerOpen = () => isOpen;

// ---------- markup ----------
function shell() {
    return `
    <div id="appointment-drawer" class="fixed inset-0 z-50 hidden" role="dialog" aria-modal="true" aria-labelledby="ad-title">
        <!-- dark backdrop, clicking it closes the drawer -->
        <div data-ad-backdrop class="absolute inset-0 bg-black/60 backdrop-blur-[2px] opacity-0 transition-opacity duration-300"></div>

        <aside id="ad-panel" class="absolute inset-y-0 right-0 w-full max-w-sm bg-app border-l border-line shadow-2xl flex flex-col translate-x-full transition-transform duration-300 ease-out">
            <header class="px-5 py-4 border-b border-line bg-surface flex items-center justify-between gap-3 shrink-0">
                <div class="flex items-center gap-2.5 text-accent">
                    ${icon("eventDone", "size-5")}
                    <h2 id="ad-title" class="font-display text-sm uppercase font-bold tracking-wider text-ink">Appointment Record</h2>
                </div>
                <button type="button" data-ad-close class="size-8 rounded-lg bg-raised hover:bg-line-strong text-muted hover:text-ink flex items-center justify-center transition cursor-pointer" aria-label="Close">
                    ${icon("close", "size-5")}
                </button>
            </header>

            <!-- the details and the buttons scroll together; when there's room, the buttons sit at the very bottom -->
            <div class="flex-1 min-h-0 overflow-y-auto">
                <div class="min-h-full flex flex-col">
                    <div id="ad-body" class="p-4 space-y-3"></div>
                    <footer id="ad-footer" class="mt-auto px-4 pb-4 space-y-2"></footer>
                </div>
            </div>
        </aside>
    </div>`;
}

const section = (label, content) => `
    <section class="card p-4">
        <p class="text-[10px] font-bold uppercase tracking-wider text-muted mb-1.5">${label}</p>
        ${content}
    </section>`;

function renderBody() {
    const a = current;
    const customer = a.customers;
    const vehicle = a.vehicles;
    const vehicleDetails = vehicle ? [vehicle.plate_number && `Plate: ${vehicle.plate_number}`, vehicle.colour].filter(Boolean).join(" · ") : "";

    $("ad-body").innerHTML = `
        ${section("Reference ID", `
            <div class="flex items-start justify-between gap-3">
                <p class="font-mono text-sm font-bold">${referenceId(a)}</p>
                ${statusBadge(a.status)}
            </div>
            <p class="mt-1 flex items-center gap-1.5 text-xs text-muted">${icon("calendar", "size-3.5")}${formatDateTime(a.appointment_datetime)}</p>
        `)}

        ${section("Client details", `
            <p class="text-base font-bold">${escapeHtml(customer?.full_name ?? "Unknown customer")}</p>
            <a href="tel:${escapeHtml(a.contact_number)}" class="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline">
                ${icon("phone", "size-3.5")}${escapeHtml(a.contact_number)}
            </a>
        `)}

        ${section("Assigned vehicle", vehicle ? `
            <p class="text-sm font-bold">${escapeHtml(vehicleName(vehicle))}</p>
            ${vehicleDetails ? `<p class="mt-1 text-xs text-muted">${escapeHtml(vehicleDetails)}</p>` : ""}
        ` : `
            <p class="text-sm font-bold">Vehicle: Not sure yet</p>
            <p class="mt-1 text-xs text-muted">Add one with Edit once the customer says which car.</p>
        `)}

        ${section("Service scope", `<p class="text-sm font-bold">${escapeHtml(a.service_requested)}</p>`)}

        ${section("Reminder", `
            <p class="flex items-center gap-1.5 text-sm font-semibold ${a.reminder_enabled === false ? "text-muted" : ""}">
                ${icon(a.reminder_enabled === false ? "bellOff" : "bell", "size-4")}${reminderLabel(a)}
            </p>
        `)}`;

    const open = isOpenStatus(a.status);
    const bookedBy = a.profiles?.full_name ?? "Unknown";
    const bookedAt = a.created_at ? ` · ${formatDateTime(a.created_at).replace(" •", ",")}` : "";

    $("ad-footer").innerHTML = `
        ${open ? `
            <div class="grid grid-cols-2 gap-2">
                <button type="button" data-ad-action="edit" class="btn btn-secondary py-2 text-xs">
                    <span class="text-accent">${icon("edit", "size-4")}</span>Edit
                </button>
                <button type="button" data-ad-action="reschedule" class="btn btn-secondary py-2 text-xs">
                    <span class="text-secondary-400">${icon("reschedule", "size-4")}</span>Reschedule
                </button>
            </div>
            <div class="grid grid-cols-2 gap-2">
                <button type="button" data-ad-action="completed" class="btn py-2 text-xs bg-status-delivered/10 text-status-delivered border border-status-delivered/30 hover:bg-status-delivered/20">
                    ${icon("check", "size-4")}Completed
                </button>
                <button type="button" data-ad-action="missed" class="btn py-2 text-xs bg-status-overdue/10 text-status-overdue border border-status-overdue/30 hover:bg-status-overdue/20">
                    ${icon("eventBusy", "size-4")}Mark as missed
                </button>
            </div>
            <button type="button" data-ad-action="cancelled" class="btn w-full py-2 text-xs bg-raised/60 text-muted hover:text-status-overdue hover:bg-status-overdue/10">
                Cancel Appointment
            </button>
        ` : a.status === "missed" ? `
            <button type="button" data-ad-action="reschedule" class="btn btn-primary w-full py-2 text-xs">
                ${icon("reschedule", "size-4")}Reschedule
            </button>
        ` : `
            <p class="flex items-center gap-2 text-xs text-muted">${icon("info", "size-4")}This appointment is ${a.status} and can't be changed.</p>
        `}

        <p class="pt-2 flex items-center justify-center gap-2 text-[11px] text-muted">
            <span class="size-5 rounded-full bg-raised border border-line-strong flex items-center justify-center text-[9px] font-bold text-ink">${escapeHtml(initials(bookedBy))}</span>
            Booked by ${escapeHtml(bookedBy)}${bookedAt}
        </p>`;
}

// ---------- open / close ----------
export function openAppointmentDrawer(appointment) {
    current = appointment;
    renderBody();
    if (isOpen) return;

    lastFocused = document.activeElement;
    $("appointment-drawer").classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
    // next frame so the slide-in transition actually runs
    requestAnimationFrame(() => {
        $("appointment-drawer").querySelector("[data-ad-backdrop]").classList.replace("opacity-0", "opacity-100");
        $("ad-panel").classList.remove("translate-x-full");
    });
    isOpen = true;
    $("appointment-drawer").querySelector("[data-ad-close]").focus();
}

export function closeAppointmentDrawer() {
    if (!isOpen) return;
    $("appointment-drawer").querySelector("[data-ad-backdrop]").classList.replace("opacity-100", "opacity-0");
    $("ad-panel").classList.add("translate-x-full");
    document.body.classList.remove("overflow-hidden");
    isOpen = false;
    setTimeout(() => {
        if (!isOpen) $("appointment-drawer").classList.add("hidden");
    }, 300);
    lastFocused?.focus?.();
}

// called after the page reloads its appointments, so the drawer shows the saved values
export function refreshAppointmentDrawer(appointments) {
    if (!isOpen || !current) return;
    const fresh = appointments.find((a) => a.appointment_id === current.appointment_id);
    if (fresh) {
        current = fresh;
        renderBody();
    } else {
        closeAppointmentDrawer();
    }
}

// ---------- setup ----------
export function initAppointmentDrawer(settings = {}) {
    options = { ...options, ...settings };
    document.body.insertAdjacentHTML("beforeend", shell());

    const root = $("appointment-drawer");

    root.addEventListener("click", async (e) => {
        if (e.target.closest("[data-ad-close]") || e.target.matches("[data-ad-backdrop]")) {
            closeAppointmentDrawer();
            return;
        }

        const btn = e.target.closest("[data-ad-action]");
        if (!btn || !current) return;
        const action = btn.dataset.adAction;

        if (action === "edit") options.onEdit(current);
        else if (action === "reschedule") options.onReschedule(current);
        else {
            btn.disabled = true;
            await options.onStatus(current, action);
            btn.disabled = false;
        }
    });

    document.addEventListener("keydown", (e) => {
        if (isOpen && e.key === "Escape" && !options.isCovered()) {
            e.preventDefault();
            closeAppointmentDrawer();
        }
    });
}
