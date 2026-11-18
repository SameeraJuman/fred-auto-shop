// add / edit customer and add / edit vehicle modals, shared by the customers list and the customer profile
//
// usage:
//   import { openCustomerModal, openVehicleModal } from "./modals.js";
//   openCustomerModal({ onSaved: (customerId) => ... });                 // add (with optional first vehicle)
//   openCustomerModal({ customer, onSaved: () => ... });                 // edit
//   openVehicleModal({ customerId, onSaved: () => ... });                // add vehicle
//   openVehicleModal({ customerId, vehicle, onSaved: () => ... });       // edit vehicle

import { supabase } from "../lib/supabase.js";

// matches the check constraint on customers.phone_number
const PHONE_PATTERN = /^[0-9+ -]{7,20}$/;

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text ?? "";
    return div.innerHTML;
}

// ---------- small building blocks ----------

const closeIcon = `<svg class="size-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;

// one labelled input. `name` is the form field name, `value` is prefilled text
function input({ name, label, value = "", placeholder = "", required = false, type = "text", maxlength, mono = false, extra = "" }) {
    return `
        <label class="block">
            <span class="block text-xs font-semibold text-muted mb-1">
                ${label}${required ? ` <span class="text-red-400">*</span>` : ` <span class="font-normal">(optional)</span>`}
            </span>
            <input name="${name}" type="${type}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"
                   ${required ? "required" : ""} ${maxlength ? `maxlength="${maxlength}"` : ""} ${extra}
                   class="field ${mono ? "font-mono uppercase" : ""}" />
        </label>`;
}

function textarea({ name, label, value = "", placeholder = "", maxlength }) {
    return `
        <label class="block">
            <span class="block text-xs font-semibold text-muted mb-1">${label} <span class="font-normal">(optional)</span></span>
            <textarea name="${name}" rows="2" ${maxlength ? `maxlength="${maxlength}"` : ""} placeholder="${escapeHtml(placeholder)}" class="field resize-none">${escapeHtml(value)}</textarea>
        </label>`;
}

function sectionTitle(title, hint) {
    return `
        <div class="mb-3">
            <h3 class="font-display text-xs font-bold tracking-widest text-accent">${title}</h3>
            <p class="text-xs text-muted">${hint}</p>
        </div>`;
}

function customerFields(c = {}) {
    return `
        <section class="rounded-lg border border-line bg-raised/40 p-4 space-y-3">
            ${sectionTitle("CUSTOMER DETAILS", "Personal identification and primary contact channels")}
            <div class="grid gap-3 sm:grid-cols-2">
                ${input({ name: "full_name", label: "Full name", value: c.full_name, placeholder: "e.g. Devon Walsh", required: true, maxlength: 100 })}
                ${input({ name: "phone_number", label: "Phone number", value: c.phone_number, placeholder: "e.g. 555-0167", required: true, maxlength: 20, type: "tel" })}
            </div>
            ${input({ name: "email", label: "Email", value: c.email, placeholder: "e.g. devon@example.com", type: "email", maxlength: 150 })}
            ${textarea({ name: "address", label: "Address", value: c.address, placeholder: "e.g. 1725 Slough Ave, Scranton, PA", maxlength: 200 })}
        </section>`;
}

function vehicleFields(v = {}, { required = true, hint = "" } = {}) {
    return `
        <div class="grid gap-3 sm:grid-cols-2">
            ${input({ name: "make", label: "Make", value: v.make, placeholder: "e.g. Toyota", required, maxlength: 50 })}
            ${input({ name: "model", label: "Model", value: v.model, placeholder: "e.g. Camry", required, maxlength: 50 })}
            ${input({ name: "year", label: "Year", value: v.year ?? "", placeholder: "e.g. 2021", required, type: "number", extra: 'min="1900" max="2100"' })}
            ${input({ name: "plate_number", label: "License plate", value: v.plate_number, placeholder: "e.g. TRN 342", required, maxlength: 15, mono: true })}
            ${input({ name: "colour", label: "Colour", value: v.colour, placeholder: "e.g. Midnight Black", maxlength: 30 })}
            ${input({ name: "engine_trim", label: "Engine / Trim", value: v.engine_trim, placeholder: "e.g. 2.5L I4", maxlength: 50 })}
        </div>
        ${hint}`;
}

// ---------- modal shell ----------

/**
 * draws a modal and returns helpers
 * @returns {{ el: HTMLElement, form: HTMLFormElement, close: function, setError: function, setBusy: function }}
 */
function createModal({ title, subtitle, bodyHtml, submitLabel }) {
    const el = document.createElement("div");
    el.className = "fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.innerHTML = `
        <form novalidate class="card w-full max-w-xl max-h-[92vh] flex flex-col shadow-2xl shadow-black/50">
            <header class="flex items-start justify-between gap-4 px-5 py-4 border-b border-line">
                <div>
                    <h2 class="font-display text-lg font-bold tracking-wide">${escapeHtml(title)}</h2>
                    <p class="text-xs text-muted">${escapeHtml(subtitle)}</p>
                </div>
                <button type="button" data-close class="text-muted hover:text-ink cursor-pointer" aria-label="Close">${closeIcon}</button>
            </header>

            <div class="flex-1 overflow-y-auto p-5 space-y-4" data-body>
                ${bodyHtml}
                <div data-notice class="hidden"></div>
            </div>

            <footer class="flex items-center justify-end gap-3 px-5 py-4 border-t border-line">
                <button type="button" data-close class="btn btn-secondary">Cancel</button>
                <button type="submit" data-submit class="btn btn-primary">${escapeHtml(submitLabel)}</button>
            </footer>
        </form>`;

    document.body.appendChild(el);
    document.body.classList.add("overflow-hidden");

    const form = el.querySelector("form");
    const notice = el.querySelector("[data-notice]");
    const submit = el.querySelector("[data-submit]");

    function onKey(event) {
        if (event.key === "Escape") close();
    }

    function close() {
        document.removeEventListener("keydown", onKey);
        document.body.classList.remove("overflow-hidden");
        el.remove();
    }

    document.addEventListener("keydown", onKey);
    el.addEventListener("mousedown", (event) => {
        if (event.target === el) close();
    });
    el.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", close));

    // tone: "error" (red) or "warn" (amber)
    function setNotice(html, tone = "error") {
        if (!html) {
            notice.classList.add("hidden");
            notice.innerHTML = "";
            return;
        }
        const colours =
            tone === "warn"
                ? "border-status-awaiting-parts/40 bg-status-awaiting-parts/10 text-status-awaiting-parts"
                : "border-status-overdue/40 bg-status-overdue/10 text-status-overdue";
        notice.className = `rounded-lg border px-3 py-2 text-sm ${colours}`;
        notice.innerHTML = html;
        notice.scrollIntoView({ block: "nearest" });
    }

    function setBusy(busy, label) {
        submit.disabled = busy;
        submit.textContent = busy ? "Saving..." : (label ?? submitLabel);
    }

    // focus the first field
    form.querySelector("input, textarea")?.focus();

    return { el, form, close, setNotice, setBusy, submit };
}

// pulls trimmed text out of the form; empty optional fields become null
function readForm(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    for (const key of Object.keys(data)) data[key] = String(data[key]).trim();
    return data;
}

const orNull = (value) => (value === "" ? null : value);

// ---------- validation ----------

function validateCustomer(d) {
    if (!d.full_name) return "Full name is required.";
    if (!PHONE_PATTERN.test(d.phone_number)) return "Enter a valid phone number (7 to 20 digits; + - and spaces allowed).";
    if (d.email && !/^\S+@\S+\.\S+$/.test(d.email)) return "That email address doesn't look right.";
    return null;
}

function validateVehicle(d) {
    if (!d.make || !d.model || !d.plate_number || !d.year) return "Make, model, year and license plate are required for a vehicle.";
    const year = Number(d.year);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) return "Year must be between 1900 and 2100.";
    return null;
}

const vehicleRow = (d, customerId) => ({
    customer_id: customerId,
    plate_number: d.plate_number.toUpperCase(),
    make: d.make,
    model: d.model,
    year: Number(d.year),
    colour: orNull(d.colour),
    engine_trim: orNull(d.engine_trim),
});

// postgres unique violation, which is what a duplicate plate number gives
const isDuplicatePlate = (error) => error?.code === "23505";

// ---------- add / edit customer ----------

export function openCustomerModal({ customer = null, onSaved } = {}) {
    const isEdit = !!customer;

    const vehicleSection = isEdit
        ? ""
        : `
        <section class="rounded-lg border border-line bg-raised/40 p-4 space-y-3">
            <div class="flex items-start justify-between gap-3">
                ${sectionTitle("VEHICLE INFORMATION", "Optional. Add their first vehicle now, or later from the profile")}
                <span class="pill status-delivered shrink-0">First vehicle</span>
            </div>
            ${vehicleFields({}, { required: false })}
        </section>`;

    const modal = createModal({
        title: isEdit ? "Edit Customer" : "Add New Customer",
        subtitle: isEdit ? "Update contact details" : "Create customer profile and register vehicle details",
        bodyHtml: customerFields(customer ?? {}) + vehicleSection,
        submitLabel: isEdit ? "Save Changes" : "Save Customer",
    });

    // set to true once the user has seen the duplicate warning and chosen to continue
    let duplicateAcknowledged = false;

    // anything typed in the phone box invalidates an earlier acknowledgement
    modal.form.elements.phone_number.addEventListener("input", () => {
        duplicateAcknowledged = false;
        modal.setNotice("");
        modal.submit.textContent = isEdit ? "Save Changes" : "Save Customer";
    });

    modal.form.addEventListener("submit", async (event) => {
        event.preventDefault();
        modal.setNotice("");

        const d = readForm(modal.form);

        let problem = validateCustomer(d);

        // vehicle is optional, but if they started filling it in it has to be complete
        const vehicleTouched = !isEdit && ["make", "model", "year", "plate_number", "colour", "engine_trim"].some((k) => d[k]);
        if (!problem && vehicleTouched) problem = validateVehicle(d);

        if (problem) return modal.setNotice(escapeHtml(problem));

        modal.setBusy(true);

        try {
            // duplicate check: same phone number already on file
            if (!duplicateAcknowledged) {
                let query = supabase.from("customers").select("customer_id, full_name").eq("phone_number", d.phone_number).limit(3);
                if (isEdit) query = query.neq("customer_id", customer.customer_id);
                const { data: matches, error } = await query;
                if (error) throw error;

                if (matches.length > 0) {
                    const links = matches
                        .map((m) => `<a class="underline font-semibold" href="/pages/customer-details.html?id=${m.customer_id}">${escapeHtml(m.full_name)}</a>`)
                        .join(", ");
                    modal.setNotice(`A customer with this phone number already exists: ${links}. Press the button again to save anyway.`, "warn");
                    duplicateAcknowledged = true;
                    modal.setBusy(false, "Save Anyway");
                    return;
                }
            }

            if (isEdit) {
                const { error } = await supabase
                    .from("customers")
                    .update({
                        full_name: d.full_name,
                        phone_number: d.phone_number,
                        email: orNull(d.email),
                        address: orNull(d.address),
                    })
                    .eq("customer_id", customer.customer_id);
                if (error) throw error;

                modal.close();
                onSaved?.(customer.customer_id);
                return;
            }

            // new customer
            const {
                data: { user },
            } = await supabase.auth.getUser();

            const { data: created, error } = await supabase
                .from("customers")
                .insert({
                    full_name: d.full_name,
                    phone_number: d.phone_number,
                    email: orNull(d.email),
                    address: orNull(d.address),
                    created_by: user?.id ?? null,
                })
                .select("customer_id")
                .single();
            if (error) throw error;

            if (vehicleTouched) {
                const { error: vehicleError } = await supabase.from("vehicles").insert(vehicleRow(d, created.customer_id));
                if (vehicleError) {
                    // the customer exists now, so don't make them retype it; send them to the profile to add the vehicle
                    console.error("Vehicle insert failed:", vehicleError);
                    modal.close();
                    onSaved?.(created.customer_id, {
                        warning: isDuplicatePlate(vehicleError)
                            ? "Customer saved, but that license plate is already registered to another vehicle."
                            : "Customer saved, but the vehicle could not be added. Add it from their profile.",
                    });
                    return;
                }
            }

            modal.close();
            onSaved?.(created.customer_id);
        } catch (error) {
            console.error("Could not save customer:", error);
            modal.setNotice("Couldn't save the customer. Check your connection and try again.");
            modal.setBusy(false);
        }
    });
}

// ---------- add / edit vehicle ----------

export function openVehicleModal({ customerId, vehicle = null, onSaved } = {}) {
    const isEdit = !!vehicle;

    const modal = createModal({
        title: isEdit ? "Edit Vehicle" : "Add Vehicle",
        subtitle: isEdit ? "Update vehicle details" : "Register another vehicle for this customer",
        bodyHtml: `<section class="space-y-3">${vehicleFields(vehicle ?? {})}</section>`,
        submitLabel: isEdit ? "Save Changes" : "Add Vehicle",
    });

    modal.form.addEventListener("submit", async (event) => {
        event.preventDefault();
        modal.setNotice("");

        const d = readForm(modal.form);
        const problem = validateVehicle(d);
        if (problem) return modal.setNotice(escapeHtml(problem));

        modal.setBusy(true);

        const row = vehicleRow(d, customerId);
        const { error } = isEdit
            ? await supabase.from("vehicles").update(row).eq("vehicle_id", vehicle.vehicle_id)
            : await supabase.from("vehicles").insert(row);

        if (error) {
            console.error("Could not save vehicle:", error);
            modal.setNotice(
                isDuplicatePlate(error)
                    ? "That license plate is already registered to another vehicle."
                    : "Couldn't save the vehicle. Try again.",
            );
            modal.setBusy(false);
            return;
        }

        modal.close();
        onSaved?.();
    });
}

// ---------- toast ----------

// small message in the bottom right; used for "saved" and warnings
export function showToast(message, tone = "ok") {
    const el = document.createElement("div");
    const colours = tone === "warn" ? "border-status-awaiting-parts/50" : "border-accent/50";
    el.className = `fixed bottom-5 right-5 z-[70] max-w-sm card px-4 py-3 text-sm shadow-2xl shadow-black/40 border ${colours}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4500);
}
