// new, edit and reschedule boxes for the appointments page (one box, three layouts)
// usage:
//   import { initAppointmentModals, openNewAppointment } from "./appointment-modals.js";
//   initAppointmentModals({ userId, getAppointments: () => list, onSaved: ({ appointmentId }) => reload() });
//   openNewAppointment({ customerId });   // customerId is optional
//   openEditAppointment(appointment);
//   openRescheduleAppointment(appointment);

import { supabase } from "../lib/supabase.js";
import { confirmDialog } from "../shared/confirm-dialog.js";
import { showToast } from "../shared/toast.js";
import {
    icon, escapeHtml, formatDateTime, referenceId, vehicleName, vehicleLabel, toLocalInput, fromLocalInput,
    reminderValue, reminderColumns, reminderOptionsHtml, findOverlap, formatTime, OVERLAP_MINUTES,
} from "./shared.js";

// same rule as the customers.phone_number check in the database
const PHONE_PATTERN = /^[0-9+ -]{7,20}$/;
const NEW_CUSTOMER = "__new";
const NEW_VEHICLE = "__new_vehicle";

const MODES = {
    new: { title: "New Appointment", icon: "addCircle", save: "Schedule Appointment" },
    edit: { title: "Edit Appointment", icon: "edit", save: "Save changes" },
    reschedule: { title: "Reschedule Appointment", icon: "reschedule", save: "Confirm Reschedule" },
};

// ---------- state ----------
let options = { userId: null, getAppointments: () => [], onSaved: () => {} };
let mode = "new";
let appointment = null; // the one being edited or rescheduled
let customers = [];
let vehicles = [];      // vehicles of the selected customer
let snapshotValue = ""; // form values when it opened, to spot unsaved changes
let isOpen = false;
let isSaving = false;
let lastFocused = null;

const $ = (id) => document.getElementById(id);

export const isAppointmentModalOpen = () => isOpen;

// ---------- markup ----------
function shell() {
    return `
    <div id="appointment-modal" class="fixed inset-0 z-60 hidden" role="dialog" aria-modal="true" aria-labelledby="am-title">
        <div data-am-backdrop class="absolute inset-0 bg-black/60 backdrop-blur-[2px] opacity-0 transition-opacity duration-200"></div>

        <div class="absolute inset-0 overflow-y-auto p-4 flex pointer-events-none">
            <form id="am-form" novalidate
                class="pointer-events-auto relative m-auto w-full max-w-md bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden
                       flex flex-col max-h-[92vh] opacity-0 scale-95 transition duration-200">

                <header class="px-5 pt-5 pb-3 flex items-start justify-between gap-3 shrink-0">
                    <div class="flex items-start gap-2.5 min-w-0">
                        <span id="am-icon" class="text-accent mt-0.5"></span>
                        <div class="min-w-0">
                            <h2 id="am-title" class="font-display text-sm uppercase font-bold tracking-wider"></h2>
                            <p id="am-subtitle" class="font-mono text-[11px] text-muted"></p>
                        </div>
                    </div>
                    <button type="button" data-am-close class="size-8 rounded-lg text-muted hover:text-ink hover:bg-raised flex items-center justify-center transition cursor-pointer" aria-label="Close">
                        ${icon("close", "size-5")}
                    </button>
                </header>

                <!-- filled per layout -->
                <div id="am-fields" class="flex-1 overflow-y-auto px-5 pb-2 flex flex-col gap-4"></div>

                <footer class="px-5 py-4 flex flex-wrap items-center justify-between gap-3 shrink-0">
                    <p id="am-message" class="text-xs text-status-overdue"></p>
                    <div class="flex items-center gap-2 ml-auto">
                        <button type="button" data-am-close class="px-4 py-2 rounded-lg text-sm font-semibold text-muted hover:text-ink transition cursor-pointer">Cancel</button>
                        <button type="submit" id="am-save" class="btn btn-primary"></button>
                    </div>
                </footer>
            </form>
        </div>
    </div>`;
}

// label with an optional note on the right, e.g. CUSTOMER (cannot be modified) ......... LOCKED
const label = (forId, text, { required = false, note = "", right = "" } = {}) => `
    <div class="flex items-center justify-between gap-2 mb-1.5">
        <label for="${forId}" class="text-[10px] font-bold uppercase tracking-wider text-muted">
            ${text}${required ? ` <span class="text-status-overdue">*</span>` : ""}${note ? ` <span class="normal-case font-semibold">(${note})</span>` : ""}
        </label>
        ${right ? `<span id="${forId}-right" class="text-[10px] font-bold uppercase tracking-wider text-muted text-right">${right}</span>` : ""}
    </div>`;

// field with an icon sitting inside it on the right
const withIcon = (inputHtml, name) => `
    <div class="relative">
        ${inputHtml}
        <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">${icon(name, "size-4")}</span>
    </div>`;

const hint = (id, text = "", iconName = "info") => `
    <p id="${id}" class="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted ${text ? "" : "hidden"}">${icon(iconName, "size-3.5")}<span>${text}</span></p>`;

const overlapBox = () => `
    <div id="am-overlap" class="hidden rounded-lg border border-status-awaiting-parts/40 bg-status-awaiting-parts/10 px-3 py-2.5 text-xs text-status-awaiting-parts flex items-start gap-2">
        ${icon("warning", "size-4")}<span id="am-overlap-text"></span>
    </div>`;

// one date and time picker, like jada's form; past times can't be picked
const dateTimeInput = (text) => `
    <div>
        ${label("am-when", text, { required: true })}
        <input id="am-when" type="datetime-local" class="field" min="${toLocalInput(new Date())}" />
        ${hint("am-when-hint", "Cannot select past dates")}
    </div>`;

const reminderSelect = (selected) => `
    <div>
        ${label("am-reminder", "Reminder")}
        <select id="am-reminder" class="field cursor-pointer">${reminderOptionsHtml(selected)}</select>
    </div>`;

// shown when "add new vehicle" is picked; the vehicle is saved for the customer together with the appointment
const newVehiclePanel = () => `
        <div id="am-new-vehicle" class="hidden rounded-xl border border-accent/30 bg-accent/5 p-3 space-y-3">
            <p class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent">${icon("car", "size-4")}New vehicle</p>
            <div class="grid grid-cols-2 gap-3">
                <div>
                    ${label("am-new-make", "Make", { required: true })}
                    <input id="am-new-make" type="text" maxlength="50" class="field" placeholder="e.g. Toyota" />
                </div>
                <div>
                    ${label("am-new-model", "Model", { required: true })}
                    <input id="am-new-model" type="text" maxlength="50" class="field" placeholder="e.g. Allion" />
                </div>
                <div>
                    ${label("am-new-year", "Year", { required: true })}
                    <input id="am-new-year" type="number" min="1900" max="2100" class="field font-mono" placeholder="e.g. 2015" />
                </div>
                <div>
                    ${label("am-new-plate", "License plate", { required: true })}
                    <input id="am-new-plate" type="text" maxlength="15" class="field font-mono uppercase" placeholder="e.g. PAA 1234" />
                </div>
            </div>
            <div>
                ${label("am-new-colour", "Colour")}
                <input id="am-new-colour" type="text" maxlength="30" class="field" placeholder="e.g. Silver" />
            </div>
        </div>`;

function newFields() {
    const customerOptions = customers
        .map((c) => `<option value="${c.customer_id}">${escapeHtml(c.full_name)}</option>`)
        .join("");

    return `
        <div>
            ${label("am-customer", "Customer", { required: true })}
            <select id="am-customer" class="field cursor-pointer">
                <option value="">Select customer</option>
                <option value="${NEW_CUSTOMER}">+ Add new customer</option>
                ${customerOptions}
            </select>
        </div>

        <!-- shown when "add new customer" is picked; saved together with the appointment -->
        <div id="am-new-customer" class="hidden rounded-xl border border-accent/30 bg-accent/5 p-3 space-y-3">
            <p class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent">${icon("personAdd", "size-4")}New customer</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                    ${label("am-new-name", "Full name", { required: true })}
                    <input id="am-new-name" type="text" maxlength="100" class="field" placeholder="e.g. Ravi Persaud" />
                </div>
                <div>
                    ${label("am-new-phone", "Phone number", { required: true })}
                    <input id="am-new-phone" type="tel" maxlength="20" class="field" placeholder="592-600-1234" />
                </div>
            </div>
            <p class="text-[11px] text-muted">Email and address can be added on the customer's page later.</p>
        </div>

        <div>
            ${label("am-contact", "Contact number", { required: true })}
            ${withIcon(`<input id="am-contact" type="tel" maxlength="20" class="field pr-9" placeholder="Filled in from the customer" />`, "phone")}
        </div>

        <div>
            ${label("am-vehicle", "Vehicle", { note: "optional", right: " " })}
            <select id="am-vehicle" class="field cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed" disabled>
                <option value="">Select a customer first</option>
            </select>
            ${hint("am-vehicle-hint", "", "car")}
        </div>

        ${newVehiclePanel()}

        <div>
            ${label("am-service", "Service requested", { required: true })}
            <input id="am-service" type="text" maxlength="255" class="field" placeholder="e.g. Alternator not charging" />
        </div>

        ${dateTimeInput("Date and time")}
        ${overlapBox()}
        ${reminderSelect("60")}`;
}

function editFields() {
    const a = appointment;
    const name = a.customers?.full_name ?? "Unknown customer";

    return `
        <div>
            ${label("am-customer-locked", "Customer", { note: "cannot be modified", right: `<span class="inline-flex items-center gap-1">${icon("lock", "size-3")}Locked</span>` })}
            ${withIcon(`<input id="am-customer-locked" type="text" class="field opacity-60 cursor-not-allowed pr-9" value="${escapeHtml(name)}" disabled />`, "lock")}
        </div>

        <div>
            <div class="flex items-center justify-between gap-2 mb-1.5">
                <span class="text-[10px] font-bold uppercase tracking-wider text-muted">Date &amp; time <span class="normal-case font-semibold">(read-only)</span></span>
                <button type="button" data-am-switch="reschedule" class="text-[11px] font-bold text-accent hover:underline cursor-pointer">Change date/time → Reschedule</button>
            </div>
            <div class="flex items-center gap-3 rounded-lg border border-line-strong bg-inset px-3 py-2.5">
                <span class="size-8 rounded-lg bg-raised text-accent flex items-center justify-center">${icon("calendar", "size-4")}</span>
                <div class="min-w-0 flex-1">
                    <p class="text-sm font-semibold">${formatDateTime(a.appointment_datetime)}</p>
                    <p class="text-[11px] text-muted">Scheduled service window</p>
                </div>
                <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-status-in-progress/15 text-status-in-progress">Locked</span>
            </div>
        </div>

        <div>
            ${label("am-contact", "Contact number", { required: true })}
            ${withIcon(`<input id="am-contact" type="tel" maxlength="20" class="field pr-9" value="${escapeHtml(a.contact_number)}" />`, "phone")}
        </div>

        <div>
            ${label("am-vehicle", "Vehicle", { right: `${escapeHtml(name)}'s vehicles` })}
            <select id="am-vehicle" class="field cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed">
                <option value="">Loading vehicles...</option>
            </select>
        </div>

        ${newVehiclePanel()}

        <div>
            ${label("am-service", "Service requested", { required: true })}
            <input id="am-service" type="text" maxlength="255" class="field" value="${escapeHtml(a.service_requested)}" />
        </div>

        ${reminderSelect(reminderValue(a))}`;
}

function rescheduleFields() {
    const a = appointment;
    const vehicle = a.vehicles;

    return `
        <section class="rounded-xl border border-line-strong bg-inset p-3 space-y-2">
            <div class="flex items-start justify-between gap-2">
                <p class="flex flex-wrap items-center gap-x-2 text-sm">
                    <span class="text-accent">${icon("personAdd", "size-4")}</span>
                    <span class="font-bold">${escapeHtml(a.customers?.full_name ?? "Unknown customer")}</span>
                    <span class="text-xs text-muted">${escapeHtml(a.contact_number)}</span>
                </p>
                <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-raised text-muted shrink-0">Read-only</span>
            </div>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                <span class="inline-flex items-center gap-1.5">${icon("car", "size-3.5")}${escapeHtml(vehicle ? `${vehicleName(vehicle)}${vehicle.plate_number ? ` (Plate: ${vehicle.plate_number})` : ""}` : "Vehicle: Not sure yet")}</span>
                <span class="inline-flex items-center gap-1.5">${icon("wrench", "size-3.5")}${escapeHtml(a.service_requested)}</span>
            </div>
        </section>

        <div class="flex items-center gap-3 rounded-xl border border-line-strong bg-inset px-3 py-2.5">
            <span class="size-8 rounded-lg bg-raised text-muted flex items-center justify-center">${icon("clock", "size-4")}</span>
            <div class="min-w-0 flex-1">
                <p class="text-[10px] font-bold uppercase tracking-wider text-muted">Currently scheduled</p>
                <p class="text-sm font-semibold">${formatDateTime(a.appointment_datetime)}</p>
            </div>
            <span class="px-2 py-0.5 rounded border border-line-strong text-[10px] font-bold uppercase tracking-wider text-muted">Replace</span>
        </div>

        ${dateTimeInput("New date and time")}
        ${overlapBox()}
        ${reminderSelect(reminderValue(a))}`;
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
    customers = data ?? [];
    return true;
}

// fills the vehicle select with one customer's vehicles
async function loadVehicles(customerId, selectedId = null) {
    const select = $("am-vehicle");
    select.disabled = true;
    select.innerHTML = `<option value="">Loading vehicles...</option>`;

    const { data, error } = await supabase
        .from("vehicles")
        .select("vehicle_id, customer_id, year, make, model, plate_number")
        .eq("customer_id", customerId)
        .order("year", { ascending: false });

    // the customer may have changed while this was loading
    if (mode === "new" && $("am-customer")?.value !== customerId) return;

    vehicles = error ? [] : data ?? [];
    if (error) console.error("Could not load vehicles:", error);

    select.innerHTML =
        `<option value="">${vehicles.length ? "Not sure yet" : "No vehicles on file"}</option>` +
        `<option value="${NEW_VEHICLE}">+ Add new vehicle</option>` +
        vehicles.map((v) => `<option value="${v.vehicle_id}" ${v.vehicle_id === selectedId ? "selected" : ""}>${escapeHtml(vehicleLabel(v))}</option>`).join("");
    select.disabled = false;

    if (mode === "edit") snapshotValue = snapshot(); // loading isn't a change
}

// ---------- new appointment: customer picker ----------
// the contact number copies the customer's phone until staff type a different one
let autoContact = "";
function fillContact(phone) {
    const input = $("am-contact");
    if (input.value.trim() === autoContact) input.value = phone;
    autoContact = phone;
}

async function onCustomerChange() {
    const value = $("am-customer").value;
    const isNew = value === NEW_CUSTOMER;
    const customer = customers.find((c) => c.customer_id === value);

    fillContact(customer?.phone_number ?? (isNew ? $("am-new-phone").value.trim() : ""));

    $("am-new-customer").classList.toggle("hidden", !isNew);
    $("am-vehicle-right").textContent = customer ? "Customer linked" : "";

    const vehicleHint = $("am-vehicle-hint");
    if (customer) {
        vehicleHint.querySelector("span").textContent = `${customer.full_name}'s saved vehicles listed`;
        vehicleHint.classList.remove("hidden");
        await loadVehicles(customer.customer_id);
    } else {
        vehicleHint.classList.toggle("hidden", !isNew);
        vehicleHint.querySelector("span").textContent = "A new customer has no vehicles yet";
        $("am-vehicle").innerHTML = isNew
            ? `<option value="">Not sure yet</option><option value="${NEW_VEHICLE}">+ Add new vehicle</option>`
            : `<option value="">Select a customer first</option>`;
        $("am-vehicle").disabled = !isNew;
    }
    onVehicleChange();

    if (isNew) $("am-new-name").focus();
}

// shows the new vehicle fields when "add new vehicle" is picked
function onVehicleChange() {
    const panel = $("am-new-vehicle");
    if (!panel) return;
    const isNew = $("am-vehicle").value === NEW_VEHICLE;
    panel.classList.toggle("hidden", !isNew);
    if (isNew) $("am-new-make").focus();
}

// ---------- overlap warning ----------
function checkOverlap() {
    const box = $("am-overlap");
    if (!box) return;
    const when = fromLocalInput($("am-when").value);
    const clash = when && findOverlap(options.getAppointments(), when, appointment?.appointment_id);

    box.classList.toggle("hidden", !clash);
    if (clash) {
        $("am-overlap-text").textContent =
            `This is within ${OVERLAP_MINUTES} minutes of ${clash.customers?.full_name ?? "another appointment"} at ${formatTime(clash.appointment_datetime)}. You can still save it.`;
    }
}

// ---------- open / close ----------
function setMessage(text = "") {
    $("am-message").textContent = text;
}

// every input and select value, to compare against when closing
function snapshot() {
    return [...$("am-fields").querySelectorAll("input, select")].map((el) => el.value).join("|");
}

function show() {
    if (!isOpen) {
        lastFocused = document.activeElement;
        $("appointment-modal").classList.remove("hidden");
        // next frame so the fade-in transition actually runs
        requestAnimationFrame(() => {
            $("appointment-modal").querySelector("[data-am-backdrop]").classList.replace("opacity-0", "opacity-100");
            $("am-form").classList.remove("opacity-0", "scale-95");
        });
    }
    isOpen = true;
}

function hide() {
    $("appointment-modal").querySelector("[data-am-backdrop]").classList.replace("opacity-100", "opacity-0");
    $("am-form").classList.add("opacity-0", "scale-95");
    isOpen = false;
    setTimeout(() => {
        if (!isOpen) $("appointment-modal").classList.add("hidden");
    }, 200);
    lastFocused?.focus?.();
}

async function close() {
    if (!isOpen || isSaving) return;
    if (snapshot() !== snapshotValue) {
        const discard = await confirmDialog({
            title: "Discard your changes?",
            message: "The details you've entered will be lost.",
            confirmLabel: "Discard",
            cancelLabel: "Keep editing",
        });
        if (!discard || !isOpen) return;
    }
    hide();
}

// draws one of the three layouts into the box
function render(nextMode) {
    mode = nextMode;
    const config = MODES[mode];

    $("am-icon").innerHTML = icon(config.icon, "size-5");
    $("am-title").textContent = config.title;
    $("am-subtitle").textContent = appointment ? referenceId(appointment) : "";
    $("am-subtitle").classList.toggle("hidden", !appointment);
    $("am-save").textContent = config.save;
    $("am-save").disabled = false;
    setMessage();

    $("am-fields").innerHTML = mode === "new" ? newFields() : mode === "edit" ? editFields() : rescheduleFields();
    snapshotValue = snapshot();
    show();
}

export async function openNewAppointment({ customerId = null } = {}) {
    if (isOpen) return;
    if (!(await loadCustomers())) {
        showToast("Couldn't load customers", "Try again in a moment", "error");
        return;
    }

    appointment = null;
    autoContact = "";
    render("new");

    // coming from a customer's page, so pick them already
    if (customerId && customers.some((c) => c.customer_id === customerId)) {
        $("am-customer").value = customerId;
        await onCustomerChange();
        snapshotValue = snapshot();
        $("am-service").focus();
    } else {
        $("am-customer").focus();
    }
}

export function openEditAppointment(record) {
    appointment = record;
    render("edit");
    loadVehicles(record.customer_id, record.vehicle_id);
    $("am-contact").focus();
}

export function openRescheduleAppointment(record) {
    appointment = record;
    render("reschedule");
    $("am-when").focus();
}

// ---------- saving ----------

// checks the form and returns the changes to save, or null with a message shown
function fail(text) {
    setMessage(text);
    return null;
}

function readWhen() {
    const when = fromLocalInput($("am-when").value);
    if (!when) return fail("Pick a date and time.");
    if (when <= new Date()) return fail("Pick a date and time in the future.");
    return when;
}

// the new vehicle fields, checked with the same rules as the vehicles table
// returns null when "add new vehicle" isn't picked, false (with a message shown) when something's wrong
function readNewVehicle() {
    if ($("am-vehicle").value !== NEW_VEHICLE) return null;
    const value = (id) => $(id).value.trim();
    const year = Number(value("am-new-year"));
    if (!value("am-new-make")) return fail("Enter the vehicle's make.") ?? false;
    if (!value("am-new-model")) return fail("Enter the vehicle's model.") ?? false;
    if (!Number.isInteger(year) || year < 1900 || year > 2100) return fail("Enter a year between 1900 and 2100.") ?? false;
    if (!value("am-new-plate")) return fail("Enter the license plate.") ?? false;
    return {
        make: value("am-new-make"),
        model: value("am-new-model"),
        year,
        plate_number: value("am-new-plate").toUpperCase(),
        colour: value("am-new-colour") || null,
    };
}

// saves a new vehicle for a customer and returns its id, or null with a message shown
async function saveNewVehicle(vehicle, customerId) {
    const { data, error } = await supabase
        .from("vehicles")
        .insert({ ...vehicle, customer_id: customerId })
        .select("vehicle_id, customer_id, year, make, model, plate_number")
        .single();
    if (error) {
        console.error("Could not save vehicle:", error);
        // 23505 is postgres's unique violation, which a duplicate plate gives
        return fail(error.code === "23505"
            ? "That license plate is already registered to another vehicle."
            : "Couldn't save the new vehicle. Please try again.");
    }

    // if the appointment fails after this, a retry uses this vehicle instead of adding it twice
    vehicles.push(data);
    $("am-vehicle").insertAdjacentHTML("beforeend", `<option value="${data.vehicle_id}">${escapeHtml(vehicleLabel(data))}</option>`);
    $("am-vehicle").value = data.vehicle_id;
    $("am-new-vehicle").classList.add("hidden");
    return data.vehicle_id;
}

function buildNew() {
    const value = (id) => $(id).value.trim();
    const customerId = $("am-customer").value;

    if (!customerId) return fail("Select a customer.");

    let newCustomer = null;
    if (customerId === NEW_CUSTOMER) {
        if (!value("am-new-name")) return fail("Enter the new customer's full name.");
        if (!PHONE_PATTERN.test(value("am-new-phone"))) return fail("Enter a valid phone number (7 to 20 digits).");
        newCustomer = { full_name: value("am-new-name"), phone_number: value("am-new-phone"), created_by: options.userId };
    }

    // an empty contact falls back to the new customer's phone
    const contact = value("am-contact") || newCustomer?.phone_number || "";
    if (!PHONE_PATTERN.test(contact)) return fail("Enter a valid contact number (7 to 20 digits).");

    const newVehicle = readNewVehicle();
    if (newVehicle === false) return null;

    if (!value("am-service")) return fail("Describe the service requested.");
    const when = readWhen();
    if (!when) return null;

    return {
        newCustomer,
        newVehicle,
        record: {
            customer_id: newCustomer ? null : customerId,
            vehicle_id: newVehicle ? null : $("am-vehicle").value || null,
            contact_number: contact,
            service_requested: value("am-service"),
            appointment_datetime: when.toISOString(),
            status: "scheduled",
            created_by: options.userId,
            ...reminderColumns($("am-reminder").value),
        },
    };
}

async function saveNew() {
    const built = buildNew();
    if (!built) return null;
    const { newCustomer, newVehicle, record } = built;

    // a new customer is saved first, then the appointment points at them
    if (newCustomer) {
        const { data, error } = await supabase.from("customers").insert(newCustomer).select("customer_id, full_name, phone_number").single();
        if (error) {
            console.error("Could not save customer:", error);
            return fail("Couldn't save the new customer. Please try again.");
        }
        record.customer_id = data.customer_id;

        // if the appointment fails below, a retry uses this customer instead of adding them twice
        customers.push(data);
        $("am-customer").insertAdjacentHTML("beforeend", `<option value="${data.customer_id}">${escapeHtml(data.full_name)}</option>`);
        $("am-customer").value = data.customer_id;
        $("am-new-customer").classList.add("hidden");
    }

    // then a new vehicle, for that customer
    if (newVehicle) {
        record.vehicle_id = await saveNewVehicle(newVehicle, record.customer_id);
        if (!record.vehicle_id) return null;
    }

    const { data, error } = await supabase.from("appointments").insert(record).select("appointment_id").single();
    if (error) {
        console.error("Could not save appointment:", error);
        return fail("Couldn't save the appointment. Please try again.");
    }

    showToast("Appointment booked", record.service_requested);
    return { appointmentId: data.appointment_id };
}

async function saveEdit() {
    const value = (id) => $(id).value.trim();
    if (!PHONE_PATTERN.test(value("am-contact"))) return fail("Enter a valid contact number (7 to 20 digits).");
    if (!value("am-service")) return fail("Describe the service requested.");
    const newVehicle = readNewVehicle();
    if (newVehicle === false) return null;

    let vehicleId = $("am-vehicle").value || null;
    if (newVehicle) {
        vehicleId = await saveNewVehicle(newVehicle, appointment.customer_id);
        if (!vehicleId) return null;
    }

    const changes = {
        contact_number: value("am-contact"),
        vehicle_id: vehicleId,
        service_requested: value("am-service"),
        ...reminderColumns($("am-reminder").value, appointment),
    };

    const { error } = await supabase.from("appointments").update(changes).eq("appointment_id", appointment.appointment_id);
    if (error) {
        console.error("Could not update appointment:", error);
        return fail("Couldn't save the changes. Please try again.");
    }

    showToast("Appointment updated", appointment.customers?.full_name ?? "");
    return { appointmentId: appointment.appointment_id };
}

async function saveReschedule() {
    const when = readWhen();
    if (!when) return null;
    if (when.getTime() === new Date(appointment.appointment_datetime).getTime()) {
        return fail("Pick a different date or time.");
    }

    const changes = {
        appointment_datetime: when.toISOString(),
        status: "rescheduled",
        ...reminderColumns($("am-reminder").value, appointment),
    };

    const { error } = await supabase.from("appointments").update(changes).eq("appointment_id", appointment.appointment_id);
    if (error) {
        console.error("Could not reschedule appointment:", error);
        return fail("Couldn't reschedule. Please try again.");
    }

    showToast("Appointment rescheduled", formatDateTime(when));
    return { appointmentId: appointment.appointment_id };
}

async function save(e) {
    e.preventDefault();
    if (isSaving) return;
    setMessage();

    isSaving = true;
    const button = $("am-save");
    button.disabled = true;
    button.textContent = "Saving...";

    let result = null;
    try {
        result = mode === "new" ? await saveNew() : mode === "edit" ? await saveEdit() : await saveReschedule();
    } finally {
        isSaving = false;
        button.disabled = false;
        button.textContent = MODES[mode].save;
    }

    if (!result) return;
    hide();
    await options.onSaved(result);
}

// ---------- setup ----------
export function initAppointmentModals(settings = {}) {
    options = { ...options, ...settings };
    document.body.insertAdjacentHTML("beforeend", shell());

    const root = $("appointment-modal");

    root.addEventListener("click", async (e) => {
        if (e.target.closest("[data-am-close]") || e.target.matches("[data-am-backdrop]")) {
            close();
            return;
        }

        // "change date/time → reschedule" on the edit box
        const switchBtn = e.target.closest("[data-am-switch]");
        if (switchBtn) {
            if (snapshot() !== snapshotValue) {
                const discard = await confirmDialog({
                    title: "Discard your edits?",
                    message: "Save them first if you want to keep them, then reschedule.",
                    confirmLabel: "Discard and reschedule",
                    cancelLabel: "Keep editing",
                });
                if (!discard) return;
            }
            openRescheduleAppointment(appointment);
        }
    });

    // picking a customer loads their vehicles; changing the date or time checks for clashes
    root.addEventListener("change", (e) => {
        if (e.target.id === "am-customer") onCustomerChange();
        if (e.target.id === "am-vehicle") onVehicleChange();
        if (e.target.id === "am-when") checkOverlap();
    });
    root.addEventListener("input", (e) => {
        if (e.target.id === "am-new-phone") fillContact(e.target.value.trim());
        if (e.target.id === "am-when") checkOverlap();
    });

    $("am-form").addEventListener("submit", save);

    document.addEventListener("keydown", (e) => {
        if (isOpen && e.key === "Escape") {
            e.preventDefault();
            close();
        }
    });
}