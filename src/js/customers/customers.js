import { supabase } from "../lib/supabase.js";
import { initPage } from "../shared/page.js";
import { openCustomerModal, showToast } from "./modals.js";

const PAGE_SIZE = 10; // rows per page

// filled from supabase in loadCustomers()
let customers = [];

// what the user has picked
let view = "all"; // 'all' or 'multiple' (more than one job)
let sortKey = "date-desc";
let currentPage = 1;

// page elements
const body = document.getElementById("customers-body");
const search = document.getElementById("search");
const sortSelect = document.getElementById("sort");
const noResults = document.getElementById("no-results");
const totalCount = document.getElementById("total-count");
const showingText = document.getElementById("showing-text");
const pagination = document.getElementById("pagination");

const chevronLeft = `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="m15 6-6 6 6 6" /></svg>`;
const chevronRight = `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>`;

// avatar colours, written out in full so tailwind can find them
const AVATARS = [
    "bg-primary-500/15 text-primary-400 border-primary-500/40",
    "bg-tertiary-500/15 text-tertiary-400 border-tertiary-500/40",
    "bg-secondary-500/15 text-secondary-400 border-secondary-500/40",
    "bg-status-awaiting-parts/15 text-status-awaiting-parts border-status-awaiting-parts/40",
    "bg-status-overdue/15 text-status-overdue border-status-overdue/40",
];

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text ?? "";
    return div.innerHTML;
}

function initials(name) {
    return (name || "?")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0].toUpperCase())
        .join("");
}

// the same customer always gets the same colour
function avatarClass(id) {
    let sum = 0;
    for (const ch of id) sum += ch.charCodeAt(0);
    return AVATARS[sum % AVATARS.length];
}

const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-CA") : ""); // 2025-03-12

// ---------- loading from supabase ----------

function showMessageRow(html) {
    body.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-muted">${html}</td></tr>`;
    noResults.classList.add("hidden");
}

async function loadCustomers() {
    showMessageRow("Loading customers...");

    const { data, error } = await supabase
        .from("customers")
        .select(`
            customer_id,
            full_name,
            phone_number,
            email,
            address,
            created_at,
            vehicles ( vehicle_id, make, model, year, plate_number ),
            jobs ( job_id )
        `)
        .order("created_at", { ascending: false });

    if (error) {
        console.error("Could not load customers:", error);
        showMessageRow(`Couldn't load customers. <button id="retry-btn" class="text-accent font-semibold hover:underline cursor-pointer">Try again</button>`);
        document.getElementById("retry-btn").addEventListener("click", async () => {
            if (await loadCustomers()) renderAll();
        });
        return false;
    }

    customers = data.map((row) => ({
        id: row.customer_id,
        name: row.full_name,
        phone: row.phone_number,
        email: row.email,
        address: row.address,
        since: row.created_at,
        vehicles: row.vehicles ?? [],
        jobCount: row.jobs?.length ?? 0,
    }));

    return true;
}

// ---------- filter, sort ----------

const sorters = {
    "date-desc": (a, b) => new Date(b.since) - new Date(a.since),
    "date-asc": (a, b) => new Date(a.since) - new Date(b.since),
    "name-asc": (a, b) => a.name.localeCompare(b.name),
    "name-desc": (a, b) => b.name.localeCompare(a.name),
    "vehicles-desc": (a, b) => b.vehicles.length - a.vehicles.length,
    "vehicles-asc": (a, b) => a.vehicles.length - b.vehicles.length,
    "jobs-desc": (a, b) => b.jobCount - a.jobCount,
    "jobs-asc": (a, b) => a.jobCount - b.jobCount,
};

function getFiltered() {
    const term = search.value.toLowerCase().trim();
    const digits = term.replace(/[^0-9]/g, "");

    return customers
        .filter((c) => {
            if (view === "multiple" && c.jobCount < 2) return false;
            if (!term) return true;

            const text = [c.name, c.email ?? "", c.phone, ...c.vehicles.map((v) => `${v.plate_number} ${v.year} ${v.make} ${v.model}`)]
                .join(" ")
                .toLowerCase();
            // "5550142" should still find "555-0142"
            const phoneDigits = c.phone.replace(/[^0-9]/g, "");
            return text.includes(term) || (digits.length >= 3 && phoneDigits.includes(digits));
        })
        .sort(sorters[sortKey]);
}

// ---------- toggle ----------
function renderToggle() {
    const multiple = customers.filter((c) => c.jobCount > 1).length;
    document.querySelectorAll(".view-btn").forEach((btn) => {
        const isActive = btn.dataset.view === view;
        btn.textContent = btn.dataset.view === "all" ? `All (${customers.length})` : `Multiple Jobs (${multiple})`;
        btn.className =
            "view-btn px-3 py-1.5 rounded-md transition cursor-pointer " +
            (isActive ? "bg-accent text-neutral-950" : "text-muted hover:text-ink");
    });
}

// ---------- table ----------
function renderTable() {
    const filtered = getFiltered();

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);

    body.innerHTML = pageRows
        .map(
            (c) => `
      <tr data-id="${c.id}" class="group odd:bg-row even:bg-row-alt hover:bg-raised/60 cursor-pointer transition">
        <td class="px-5 py-4">
          <div class="flex items-center gap-3">
            <span class="size-10 shrink-0 rounded-full border flex items-center justify-center text-xs font-bold ${avatarClass(c.id)}">${escapeHtml(initials(c.name))}</span>
            <div class="min-w-0">
              <p class="text-sm font-semibold">${escapeHtml(c.name)}</p>
              ${c.email ? `<p class="text-xs text-muted truncate">${escapeHtml(c.email)}</p>` : `<p class="text-xs text-muted italic">No email on file</p>`}
            </div>
          </div>
        </td>
        <td class="px-5 py-4 font-mono text-sm whitespace-nowrap">${escapeHtml(c.phone)}</td>
        <td class="px-5 py-4 font-mono text-xs text-muted whitespace-nowrap">${formatDate(c.since)}</td>
        <td class="px-5 py-4 text-center text-sm ${c.vehicles.length > 1 ? "text-accent font-semibold" : ""}">${c.vehicles.length}</td>
        <td class="px-5 py-4 text-center text-sm">${c.jobCount}</td>
        <td class="px-5 py-4 text-sm">
          ${
              c.vehicles.length
                  ? c.vehicles.map((v) => `<p>${escapeHtml(`${v.year} ${v.make} ${v.model}`)}</p>`).join("")
                  : `<span class="text-muted italic">No vehicles</span>`
          }
        </td>
        <td class="px-5 py-4 text-muted group-hover:text-ink">${chevronRight}</td>
      </tr>`,
        )
        .join("");

    noResults.classList.toggle("hidden", filtered.length > 0);
    renderFooter(filtered.length, start, pageRows.length, totalPages);
}

// ---------- footer ----------

// page list like 1 … 4 5 6 … 100
function pageNumbers(total, current) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = [1];
    const from = Math.max(2, current - 1);
    const to = Math.min(total - 1, current + 1);
    if (from > 2) pages.push("...");
    for (let p = from; p <= to; p++) pages.push(p);
    if (to < total - 1) pages.push("...");
    pages.push(total);
    return pages;
}

function renderFooter(total, start, shown, totalPages) {
    showingText.innerHTML =
        total === 0
            ? `Showing <span class="font-semibold text-ink">0</span>`
            : `Showing <span class="font-semibold text-ink">${start + 1}–${start + shown}</span>
         of <span class="font-semibold text-ink">${total}</span> customers`;

    const pageBtn = (content, page, { current = false, disabled = false } = {}) => `
      <button data-page="${page}" ${disabled ? "disabled" : ""}
        class="min-w-10 h-10 px-3 flex items-center justify-center border-l border-line-strong first:border-l-0 transition
        ${current ? "bg-raised text-ink font-semibold" : "text-muted hover:bg-raised hover:text-ink"}
        disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent">
        ${content}
      </button>`;

    pagination.innerHTML =
        pageBtn(chevronLeft, currentPage - 1, { disabled: currentPage === 1 }) +
        pageNumbers(totalPages, currentPage)
            .map((p) =>
                p === "..."
                    ? `<span class="min-w-10 h-10 px-3 flex items-center justify-center border-l border-line-strong text-muted">…</span>`
                    : pageBtn(p, p, { current: p === currentPage }),
            )
            .join("") +
        pageBtn(chevronRight, currentPage + 1, { disabled: currentPage === totalPages });
}

// ---------- export ----------

// downloads whatever the table is currently showing (after search / filter / sort)
function exportCsv() {
    const cell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const header = ["Name", "Phone", "Email", "Address", "Member since", "Vehicles", "Jobs"];
    const rows = getFiltered().map((c) => [
        c.name,
        c.phone,
        c.email,
        c.address,
        formatDate(c.since),
        c.vehicles.map((v) => `${v.year} ${v.make} ${v.model} (${v.plate_number})`).join("; "),
        c.jobCount,
    ]);

    const csv = [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ---------- draw everything ----------
function renderAll() {
    totalCount.textContent = `${customers.length} total`;
    renderToggle();
    renderTable();
}

// ---------- events ----------
function setupEvents() {
    document.querySelectorAll(".view-btn").forEach((btn) =>
        btn.addEventListener("click", () => {
            view = btn.dataset.view;
            currentPage = 1;
            renderToggle();
            renderTable();
        }),
    );

    sortSelect.addEventListener("change", () => {
        sortKey = sortSelect.value;
        currentPage = 1;
        renderTable();
    });

    search.addEventListener("input", () => {
        currentPage = 1;
        renderTable();
    });

    pagination.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-page]");
        if (!btn || btn.disabled) return;
        currentPage = Number(btn.dataset.page);
        renderTable();
    });

    body.addEventListener("click", (e) => {
        const row = e.target.closest("tr[data-id]");
        if (row) window.location.href = `/pages/customer-details.html?id=${row.dataset.id}`;
    });

    document.getElementById("export-btn").addEventListener("click", exportCsv);

    document.getElementById("new-customer-btn").addEventListener("click", () => {
        openCustomerModal({
            onSaved: async (customerId, { warning } = {}) => {
                showToast(warning ?? "Customer saved.", warning ? "warn" : "ok");
                if (await loadCustomers()) renderAll();
                // a vehicle problem means they need the profile page to fix it
                if (warning) setTimeout(() => (window.location.href = `/pages/customer-details.html?id=${customerId}`), 1500);
            },
        });
    });
}

// ---------- start ----------
async function main() {
    const page = await initPage({ active: "customers" });
    if (!page) return;

    setupEvents();

    if (await loadCustomers()) renderAll();
}

main();
