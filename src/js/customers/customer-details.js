import { supabase } from "../lib/supabase.js";
import { initPage } from "../shared/page.js";
import { openCustomerModal, openVehicleModal, showToast } from "./modals.js";

// same labels and pill classes as the jobs page (keys match the job_status enum)
const statuses = {
    overdue: { label: "Overdue", pill: "status-overdue" },
    in_progress: { label: "In Progress", pill: "status-in-progress" },
    awaiting_parts: { label: "Awaiting Parts", pill: "status-awaiting-parts" },
    not_started: { label: "Not Started", pill: "status-not-started" },
    ready_for_pickup: { label: "Ready for Pickup", pill: "status-ready" },
    delivered: { label: "Delivered", pill: "status-delivered" },
};

const carIcon = `<svg class="size-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>`;
const dotsIcon = `<svg class="size-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>`;

const customerId = new URLSearchParams(window.location.search).get("id");

let isAdmin = false;
let customer = null;
let vehicles = [];
let jobs = [];

const $ = (id) => document.getElementById(id);

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text ?? "";
    return div.innerHTML;
}

const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-CA") : ""); // 2026-09-16

function showMessage(html) {
    $("state-message").innerHTML = html;
    $("state-message").classList.remove("hidden");
    $("content").classList.add("hidden");
    $("actions").classList.add("hidden");
}

// ---------- loading ----------

async function loadCustomer() {
    if (!customerId) {
        showMessage("No customer selected. <a href='/pages/customers.html' class='text-accent font-semibold hover:underline'>Back to customers</a>");
        return false;
    }

    const [customerRes, vehiclesRes, jobsRes] = await Promise.all([
        supabase
            .from("customers")
            .select("customer_id, full_name, phone_number, email, address, created_at")
            .eq("customer_id", customerId)
            .maybeSingle(),
        supabase
            .from("vehicles")
            .select("vehicle_id, plate_number, make, model, year, colour, engine_trim")
            .eq("customer_id", customerId)
            .order("created_at"),
        supabase
            .from("jobs")
            .select("job_id, problem_description, status, registered_at, vehicles ( year, make, model )")
            .eq("customer_id", customerId)
            .order("registered_at", { ascending: false }),
    ]);

    const error = customerRes.error || vehiclesRes.error || jobsRes.error;
    if (error) {
        console.error("Could not load customer:", error);
        showMessage(`Couldn't load this customer. <button id="retry-btn" class="text-accent font-semibold hover:underline cursor-pointer">Try again</button>`);
        $("retry-btn").addEventListener("click", reload);
        return false;
    }

    if (!customerRes.data) {
        showMessage("Customer not found. <a href='/pages/customers.html' class='text-accent font-semibold hover:underline'>Back to customers</a>");
        return false;
    }

    customer = customerRes.data;
    vehicles = vehiclesRes.data;
    jobs = jobsRes.data;
    return true;
}

// ---------- drawing ----------

function renderHeader() {
    document.title = `${customer.full_name} - Fred's Auto Electrical`;
    $("customer-name").textContent = customer.full_name;
    $("customer-phone").textContent = customer.phone_number;
    $("customer-since").textContent = `Customer since ${formatDate(customer.created_at)}`;

    const email = $("customer-email");
    $("customer-email-wrap").classList.toggle("hidden", !customer.email);
    if (customer.email) {
        email.textContent = customer.email;
        email.href = `mailto:${customer.email}`;
    }

    const address = $("customer-address");
    address.textContent = customer.address ?? "";
    address.classList.toggle("hidden", !customer.address);

    // jobs / appointments pages don't read these yet; they carry the customer id so they can prefill
    $("new-job-link").href = `/pages/jobs.html?new=1&customer=${customer.customer_id}`;
    $("new-appointment-link").href = `/pages/appointments.html?new=1&customer=${customer.customer_id}`;
}

function renderVehicles() {
    $("vehicles-title").innerHTML = `VEHICLES (${vehicles.length}) <span class="inline-block size-1.5 rounded-full bg-accent align-middle ml-1"></span>`;

    if (!vehicles.length) {
        $("vehicles").innerHTML = `<p class="md:col-span-2 card p-6 text-center text-sm text-muted">No vehicles registered yet.</p>`;
        return;
    }

    $("vehicles").innerHTML = vehicles
        .map(
            (v) => `
        <article class="card p-4 flex items-start gap-4 relative">
            <span class="size-12 shrink-0 rounded-lg bg-raised text-muted flex items-center justify-center">${carIcon}</span>
            <div class="min-w-0 flex-1">
                <h3 class="font-display text-lg font-semibold">${escapeHtml(`${v.year} ${v.make} ${v.model}`)}</h3>
                ${v.colour ? `<p class="text-sm text-muted">${escapeHtml(v.colour)}</p>` : ""}
                <div class="mt-3 flex flex-wrap items-center gap-2">
                    <span class="plate text-sm px-3 py-1.5">${escapeHtml(v.plate_number)}</span>
                    ${v.engine_trim ? `<span class="text-xs px-2 py-1 rounded bg-raised border border-line-strong">${escapeHtml(v.engine_trim)}</span>` : ""}
                </div>
            </div>
            <button data-vehicle-edit="${v.vehicle_id}" class="text-muted hover:text-ink cursor-pointer" aria-label="Edit vehicle" title="Edit vehicle">${dotsIcon}</button>
        </article>`,
        )
        .join("");
}

function renderJobs() {
    $("jobs-title").innerHTML = `JOB HISTORY (${jobs.length}) <span class="inline-block size-1.5 rounded-full bg-accent align-middle ml-1"></span>`;

    if (!jobs.length) {
        $("jobs").innerHTML = `<p class="p-6 text-center text-sm text-muted">No jobs yet.</p>`;
        return;
    }

    $("jobs").innerHTML = jobs
        .map((j) => {
            const status = statuses[j.status] ?? statuses.not_started;
            const vehicle = j.vehicles ? `${j.vehicles.year} ${j.vehicles.make} ${j.vehicles.model}` : "";
            return `
        <a href="/pages/job-details.html?id=${j.job_id}" class="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 hover:bg-raised/60 transition">
            <div class="min-w-0 flex-1 basis-64">
                <p class="text-sm font-semibold line-clamp-1">${escapeHtml(j.problem_description)}</p>
                ${vehicle ? `<p class="text-xs text-muted mt-0.5">${escapeHtml(vehicle)}</p>` : ""}
            </div>
            <span class="font-mono text-xs text-muted">${formatDate(j.registered_at)}</span>
            <span class="pill ${status.pill}"><span class="w-1.5 h-1.5 rounded-full bg-current"></span>${status.label}</span>
        </a>`;
        })
        .join("");
}

function renderAll() {
    $("state-message").classList.add("hidden");
    $("content").classList.remove("hidden");
    $("actions").classList.remove("hidden");
    $("more-wrap").classList.toggle("hidden", !isAdmin);
    renderHeader();
    renderVehicles();
    renderJobs();
}

async function reload() {
    if (await loadCustomer()) renderAll();
}

// ---------- events ----------

async function deleteCustomer() {
    $("more-menu").classList.add("hidden");

    if (vehicles.length || jobs.length) {
        showToast("This customer still has vehicles or jobs, so they can't be deleted.", "warn");
        return;
    }
    if (!window.confirm(`Delete ${customer.full_name}? This can't be undone.`)) return;

    const { error } = await supabase.from("customers").delete().eq("customer_id", customer.customer_id);
    if (error) {
        console.error("Could not delete customer:", error);
        showToast("Couldn't delete this customer.", "warn");
        return;
    }
    window.location.href = "/pages/customers.html";
}

function setupEvents() {
    $("edit-btn").addEventListener("click", () =>
        openCustomerModal({
            customer,
            onSaved: async () => {
                showToast("Customer updated.");
                await reload();
            },
        }),
    );

    $("add-vehicle-btn").addEventListener("click", () =>
        openVehicleModal({
            customerId,
            onSaved: async () => {
                showToast("Vehicle added.");
                await reload();
            },
        }),
    );

    $("vehicles").addEventListener("click", (event) => {
        const btn = event.target.closest("[data-vehicle-edit]");
        if (!btn) return;
        const vehicle = vehicles.find((v) => v.vehicle_id === btn.dataset.vehicleEdit);
        openVehicleModal({
            customerId,
            vehicle,
            onSaved: async () => {
                showToast("Vehicle updated.");
                await reload();
            },
        });
    });

    // overflow menu
    $("more-btn").addEventListener("click", (event) => {
        event.stopPropagation();
        const open = $("more-menu").classList.toggle("hidden") === false;
        $("more-btn").setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", () => $("more-menu").classList.add("hidden"));
    $("delete-btn").addEventListener("click", deleteCustomer);
}

// ---------- start ----------
async function main() {
    const page = await initPage({ active: "customers" });
    if (!page) return;

    isAdmin = page.profile.role === "admin";
    setupEvents();
    await reload();
}

main();
