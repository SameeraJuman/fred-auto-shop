// "add customer" and "new appointment" modal on the dashboards
// new jobs use the jobs page's own modal (new-job-modal.js), so this only handles the other two
// usage:
//   import { initQuickAddModal, openQuickAddModal } from "./quick-add-modal.js";
//   initQuickAddModal({ userId, onCreated: (type) => reloadTheDashboard() });
//   openQuickAddModal("customer");   // or "appointment"

// note: once the customers and appointments pages have their own modals,
// the dashboard buttons should open those instead (like new job does) and this file can go

import { supabase } from "../lib/supabase.js";
import { confirmDialog } from "../shared/confirm-dialog.js";
import { showToast } from "../shared/toast.js";

// same rule as the customers.phone_number check in the database
const PHONE_PATTERN = /^[0-9+ -]{7,20}$/;

const ICONS = {
    close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
    personAdd: "M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
    calendar: "M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z",
};

// title, icon and save label for each type
const TYPES = {
    customer: { title: "Add customer", icon: "personAdd", save: "Save customer", done: "Customer added" },
    appointment: { title: "New appointment", icon: "calendar", save: "Save appointment", done: "Appointment booked" },
};

function icon(name, size = "size-4") {
    return `<svg class="${size} shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
}

// text from the database gets escaped before it goes into html
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text ?? "";
    return div.innerHTML;
}

// now as yyyy-mm-ddThh:mm in local time, for the datetime input's min
function nowLocalInput() {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const vehicleLabel = (v) => `${v.year} ${v.make} ${v.model} (${v.plate_number})`;

// ---------- state ----------
let options = { userId: null, onCreated: () => {} };
let type = "customer";
let customers = [];
let vehicles = [];
let isOpen = false;
let isSaving = false;
let lastFocused = null;

const $ = (id) => document.getElementById(id);

// ---------- markup ----------

const fieldLabel = (forId, text, required = false) => `
    <label for="${forId}" class="block text-[11px] font-semibold uppercase tracking-wider text-muted font-display mb-1.5">
        ${text}${required ? ` <span class="text-status-overdue">*</span>` : ""}
    </label>`;

const shell = () => `
    <div id="quick-add-modal" class="fixed inset-0 z-50 hidden" role="dialog" aria-modal="true" aria-labelledby="quick-add-title">
        <div data-modal-backdrop class="absolute inset-0 bg-black/60 backdrop-blur-[2px] opacity-0 transition-opacity duration-200"></div>

        <div class="absolute inset-0 overflow-y-auto p-4 flex pointer-events-none">
            <form id="quick-add-form" novalidate
                class="pointer-events-auto relative m-auto w-full max-w-lg bg-app border border-line rounded-2xl shadow-2xl overflow-hidden
                       flex flex-col max-h-[92vh] opacity-0 scale-95 transition duration-200">

                <header class="px-6 py-4 border-b border-line bg-surface flex items-center justify-between gap-3 shrink-0">
                    <div class="flex items-center gap-3">
                        <div id="quick-add-icon" class="size-9 rounded-lg bg-accent/15 text-accent border border-accent/30 flex items-center justify-center"></div>
                        <h2 id="quick-add-title" class="font-display text-base uppercase font-bold tracking-wider"></h2>
                    </div>
                    <button type="button" data-modal-close class="size-8 rounded-lg bg-raised hover:bg-line-strong text-muted hover:text-ink flex items-center justify-center transition cursor-pointer" aria-label="Close">
                        ${icon("close", "size-5")}
                    </button>
                </header>

                <!-- filled per type by renderFields() -->
                <div id="quick-add-fields" class="flex-1 overflow-y-auto p-6 flex flex-col gap-5"></div>

                <footer class="px-6 py-4 border-t border-line bg-surface flex flex-wrap items-center justify-between gap-3 shrink-0">
                    <p id="quick-add-message" class="text-xs text-status-overdue"></p>
                    <div class="flex gap-2 ml-auto">
                        <button type="button" data-modal-close class="btn btn-secondary">Cancel</button>
                        <button type="submit" id="quick-add-save" class="btn btn-primary"></button>
                    </div>
                </footer>
            </form>
        </div>
    </div>`;

function customerFields() {
    return `
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
                ${fieldLabel("qa-name", "Full name", true)}
                <input id="qa-name" type="text" maxlength="100" class="field" placeholder="e.g. Ravi Persaud" />
            </div>
            <div>
                ${fieldLabel("qa-phone", "Phone number", true)}
                <input id="qa-phone" type="tel" maxlength="20" class="field" placeholder="592-600-1234" />
            </div>
        </div>
        <div>
            ${fieldLabel("qa-email", "Email address")}
            <input id="qa-email" type="email" maxlength="150" class="field" placeholder="customer@example.com" />
        </div>
        <div>
            ${fieldLabel("qa-address", "Address")}
            <input id="qa-address" type="text" maxlength="200" class="field" placeholder="Street, village or town" />
        </div>`;
}

function appointmentFields() {
    const customerOptions = customers
        .map((c) => `<option value="${c.customer_id}">${escapeHtml(c.full_name)}</option>`)
        .join("");

    return `
        <div>
            ${fieldLabel("qa-customer", "Customer", true)}
            <select id="qa-customer" class="field cursor-pointer">
                <option value="">Select customer</option>${customerOptions}
            </select>
        </div>
        <div>
            ${fieldLabel("qa-vehicle", "Vehicle")}
            <select id="qa-vehicle" class="field cursor-pointer disabled:opacity-60" disabled>
                <option value="">Select a customer first</option>
            </select>
        </div>
        <div>
            ${fieldLabel("qa-contact", "Contact number", true)}
            <input id="qa-contact" type="tel" maxlength="20" class="field" placeholder="Filled in from the customer" />
        </div>
        <div>
            ${fieldLabel("qa-service", "Service requested", true)}
            <input id="qa-service" type="text" maxlength="255" class="field" placeholder="e.g. Alternator not charging" />
        </div>
        <div>
            ${fieldLabel("qa-when", "Date and time", true)}
            <input id="qa-when" type="datetime-local" class="field" />
        </div>

        <div class="border-t border-line pt-4 space-y-3">
            <label class="flex items-center justify-between gap-3 cursor-pointer">
                <span class="flex items-center gap-2 text-sm font-semibold">
                    <span>Appointment reminder</span>
                </span>

                <input
                    id="qa-reminder-enabled"
                    type="checkbox"
                    class="size-4 accent-teal-500"
                    checked
                />
            </label>

            <div id="qa-reminder-settings">
                ${fieldLabel("qa-reminder-time", "Remind before appointment")}

                <select id="qa-reminder-time" class="field cursor-pointer">
                    <option value="15">15 minutes before</option>
                    <option value="30">30 minutes before</option>
                    <option value="60" selected>1 hour before</option>
                    <option value="120">2 hours before</option>
                    <option value="1440">1 day before</option>
                </select>
            </div>
        </div>`;
}

// ---------- loading ----------

async function loadCustomers() {
    const { data, error } = await supabase
        .from("customers")
        .select("customer_id, full_name, phone_number")
        .order("full_name");

    if (error) {
        console.error("Could not load customers:", error);
        return false;
    }
    customers = data;
    return true;
}

async function loadVehicles(customerId) {
    const select = $("qa-vehicle");
    select.disabled = true;
    select.innerHTML = `<option value="">Loading vehicles...</option>`;

    const { data, error } = await supabase
        .from("vehicles")
        .select("vehicle_id, make, model, year, plate_number")
        .eq("customer_id", customerId);

    // the customer may have changed while this was loading
    if ($("qa-customer").value !== customerId) return;

    vehicles = error ? [] : data;
    select.innerHTML =
        `<option value="">${vehicles.length ? "Not specified yet" : "No vehicles on file"}</option>` +
        vehicles.map((v) => `<option value="${v.vehicle_id}">${escapeHtml(vehicleLabel(v))}</option>`).join("");
    select.disabled = vehicles.length === 0;
}

// ---------- open / close ----------

function setMessage(text = "") {
    $("quick-add-message").textContent = text;
}

// true if the user has typed or picked anything
function hasChanges() {
    return [...$("quick-add-fields").querySelectorAll("input, select")].some((el) => el.value.trim() !== "");
}

function show() {
    $("quick-add-modal").classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
    // next frame so the fade-in transition actually runs
    requestAnimationFrame(() => {
        $("quick-add-modal").querySelector("[data-modal-backdrop]").classList.replace("opacity-0", "opacity-100");
        $("quick-add-form").classList.remove("opacity-0", "scale-95");
    });
    isOpen = true;
}

function hide() {
    $("quick-add-modal").querySelector("[data-modal-backdrop]").classList.replace("opacity-100", "opacity-0");
    $("quick-add-form").classList.add("opacity-0", "scale-95");
    document.body.classList.remove("overflow-hidden");
    isOpen = false;
    setTimeout(() => {
        if (!isOpen) $("quick-add-modal").classList.add("hidden");
    }, 200);
    lastFocused?.focus?.();
}

export const isQuickAddOpen = () => isOpen;

export async function openQuickAddModal(nextType) {
    if (isOpen || !TYPES[nextType]) return;

    // an appointment needs a customer to book it for
    if (nextType === "appointment") {
        if (!(await loadCustomers())) {
            showToast("Couldn't load customers", "Try again in a moment", "error");
            return;
        }
        if (!customers.length) {
            showToast("No customers yet", "Add a customer before booking an appointment", "error");
            return;
        }
    }

    type = nextType;
    lastFocused = document.activeElement;

    const config = TYPES[type];
    $("quick-add-title").textContent = config.title;
    $("quick-add-icon").innerHTML = icon(config.icon, "size-5");
    $("quick-add-save").textContent = config.save;
    $("quick-add-save").disabled = false;
    $("quick-add-fields").innerHTML = type === "customer" ? customerFields() : appointmentFields();
    setMessage();

    if (type === "appointment") {
        $("qa-when").min = nowLocalInput();
    }

    show();
    $("quick-add-fields").querySelector("input, select").focus();
}

async function closeQuickAddModal() {
    if (!isOpen || isSaving) return;
    if (hasChanges()) {
        const discard = await confirmDialog({
            title: `Discard this ${type}?`,
            message: "The details you've entered will be lost.",
            confirmLabel: "Discard",
            cancelLabel: "Keep editing",
        });
        if (!discard || !isOpen) return;
    }
    hide();
}

// ---------- saving ----------

// shows the message and returns null, so buildRecord can stop in one line
function fail(text) {
    setMessage(text);
    return null;
}

// checks the form and returns the row to insert, or null with a message shown
function buildRecord() {
    const value = (id) => $(id).value.trim();

    if (type === "customer") {
        if (!value("qa-name")) return fail("Full name is required.");
        if (!PHONE_PATTERN.test(value("qa-phone"))) return fail("Enter a valid phone number (7 to 20 digits).");
        if (value("qa-email") && !$("qa-email").checkValidity()) return fail("Enter a valid email address.");

        return {
            full_name: value("qa-name"),
            phone_number: value("qa-phone"),
            email: value("qa-email") || null,
            address: value("qa-address") || null,
            created_by: options.userId,
        };
    }

    const when = new Date(value("qa-when"));
    if (!value("qa-customer")) return fail("Select a customer.");
    if (!value("qa-contact")) return fail("Contact number is required.");
    if (!value("qa-service")) return fail("Describe the service requested.");
    if (Number.isNaN(when.getTime()) || when <= new Date()) return fail("Pick a date and time in the future.");

    return {
        customer_id: value("qa-customer"),
        vehicle_id: value("qa-vehicle") || null,
        contact_number: value("qa-contact"),
        service_requested: value("qa-service"),
        appointment_datetime: when.toISOString(),

        reminder_enabled: $("qa-reminder-enabled").checked,
        reminder_lead_minutes: Number($("qa-reminder-time").value),

        created_by: options.userId,
    };
}

async function save(e) {
    e.preventDefault();
    if (isSaving) return;

    setMessage();
    const record = buildRecord();
    if (!record) return;

    isSaving = true;
    const button = $("quick-add-save");
    button.disabled = true;
    button.textContent = "Saving...";

    const table = type === "customer" ? "customers" : "appointments";
    const { error } = await supabase.from(table).insert(record);

    isSaving = false;
    button.disabled = false;
    button.textContent = TYPES[type].save;

    if (error) {
        console.error(`Could not save ${type}:`, error);
        setMessage(`Couldn't save the ${type}. Please try again.`);
        return;
    }

    const savedType = type;
    hide();
    showToast(TYPES[savedType].done, savedType === "customer" ? record.full_name : record.service_requested);
    options.onCreated(savedType);
}

// ---------- setup ----------
export function initQuickAddModal({ userId, onCreated = () => {} } = {}) {
    options = { userId, onCreated };
    document.body.insertAdjacentHTML("beforeend", shell());

    const root = $("quick-add-modal");

    root.addEventListener("click", (e) => {
        if (e.target.closest("[data-modal-close]") || e.target.matches("[data-modal-backdrop]")) {
            closeQuickAddModal();
        }
    });

    // picking a customer loads their vehicles and fills in their phone number
    root.addEventListener("change", (e) => {
        if (e.target.id !== "qa-reminder-enabled") return;

        const enabled = e.target.checked;
        $("qa-reminder-time").disabled = !enabled;
        $("qa-reminder-settings").classList.toggle("opacity-50", !enabled);
    });

    $("quick-add-form").addEventListener("submit", save);

    document.addEventListener("keydown", (e) => {
        if (isOpen && e.key === "Escape") {
            e.preventDefault();
            closeQuickAddModal();
        }
    });
}
