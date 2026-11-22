// reports page (admins only)
// shows completed jobs, new customers, turnaround, missed appointments and revenue
// for a week, month or year, compared with the period before it

import { supabase } from "../lib/supabase.js";
import { initPage } from "../shared/page.js";
import { showToast } from "../shared/toast.js";

const BUCKET = "job-photos";

// label, pill and bar colour for each job status
// class names are written out in full so tailwind can find them
const statuses = {
    not_started:      { label: "Not started",      pill: "status-not-started",    colour: "var(--color-status-not-started)" },
    in_progress:      { label: "In progress",      pill: "status-in-progress",    colour: "var(--color-status-in-progress)" },
    awaiting_parts:   { label: "Awaiting parts",   pill: "status-awaiting-parts", colour: "var(--color-status-awaiting-parts)" },
    overdue:          { label: "Overdue",          pill: "status-overdue",        colour: "var(--color-status-overdue)" },
    ready_for_pickup: { label: "Ready for pickup", pill: "status-ready",          colour: "var(--color-status-ready)" },
    delivered:        { label: "Delivered",        pill: "status-delivered",      colour: "var(--color-status-delivered)" },
};

// words used in the "vs last ..." notes
const periodWords = { week: "last week", month: "last month", year: "last year" };

let period = "week";
let anchor = new Date(); // any day inside the period being shown
let me = null;           // the signed in admin's profile
let sales = [];          // sales in the current period, kept for the csv export
let loadCount = 0;       // stops an older, slower load from overwriting a newer one
let missedRows = [];     // missed appointments on screen, so the reschedule modal can find them
let rebooked = new Map(); // missed appointment id -> date of the upcoming appointment booked for it
let rescheduling = null; // the missed appointment the modal is open for
let lastFocused = null;

const $ = (id) => document.getElementById(id);

// text from the database gets escaped before it goes into html
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text ?? "";
    return div.innerHTML;
}

// ---------- small helpers ----------

// yyyy-mm-dd in local time (for the payment_date column, which is a date)
const isoDate = (date) => date.toLocaleDateString("en-CA");

// e.g. 16 Nov 2026
const formatDate = (value) =>
    new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

// e.g. 16 Nov 2026, 2:30 pm
const formatDateTime = (value) =>
    new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

// e.g. GYD 45,000.00
const formatMoney = (amount) =>
    `GYD ${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// e.g. GYD 1,485,000 (cents only shown when there are some)
const formatMoneyShort = (amount) =>
    `GYD ${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

// short readable job number from the uuid, same as the job drawer, e.g. 3F9A1C
const jobNumber = (id) => id.replace(/-/g, "").slice(-6).toUpperCase();

const vehicleName = (v) => (v ? `${v.year} ${v.make} ${v.model}` : "—");

// payment_date is a plain date, so build it at local midnight instead of utc
const parseDay = (text) => {
    const [y, m, d] = text.split("-").map(Number);
    return new Date(y, m - 1, d);
};

// average turnaround in days, rounded to one decimal, or null when nothing was delivered
function averageTurnaround(jobs) {
    if (!jobs.length) return null;
    const total = jobs.reduce((sum, j) => sum + (new Date(j.delivered_at) - new Date(j.registered_at)), 0);
    return Math.round((total / jobs.length / 86400000) * 10) / 10;
}

// ---------- periods ----------

// start (inclusive) and end (exclusive) of the period that holds `date`
function rangeFor(date, kind) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (kind === "week") {
        // weeks start on monday
        const start = new Date(d);
        start.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        const end = new Date(start);
        end.setDate(start.getDate() + 7);
        return { start, end };
    }
    if (kind === "month") {
        return { start: new Date(d.getFullYear(), d.getMonth(), 1), end: new Date(d.getFullYear(), d.getMonth() + 1, 1) };
    }
    return { start: new Date(d.getFullYear(), 0, 1), end: new Date(d.getFullYear() + 1, 0, 1) };
}

// the period just before the given one
function previousRange({ start }, kind) {
    const dayBefore = new Date(start);
    dayBefore.setDate(start.getDate() - 1);
    return rangeFor(dayBefore, kind);
}

// moves the anchor one period back (-1) or forward (+1)
function shiftAnchor(step) {
    const d = new Date(anchor);
    if (period === "week") d.setDate(d.getDate() + 7 * step);
    else if (period === "month") d.setMonth(d.getMonth() + step, 1);
    else d.setFullYear(d.getFullYear() + step, 0, 1);
    anchor = d;
}

function periodLabel({ start, end }) {
    if (period === "year") return String(start.getFullYear());
    if (period === "month") return start.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const last = new Date(end);
    last.setDate(end.getDate() - 1);
    const short = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    return `${short(start)} – ${short(last)} ${last.getFullYear()}`;
}

// chart buckets: days for a week or month, months for a year
function bucketsFor({ start, end }) {
    const buckets = [];
    if (period === "year") {
        for (let m = 0; m < 12; m++) {
            const from = new Date(start.getFullYear(), m, 1);
            buckets.push({ from, to: new Date(start.getFullYear(), m + 1, 1), label: from.toLocaleDateString("en-GB", { month: "short" }) });
        }
        return buckets;
    }
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
        const from = new Date(d);
        const to = new Date(d);
        to.setDate(d.getDate() + 1);
        const label = period === "week" ? from.toLocaleDateString("en-GB", { weekday: "short" }) : String(from.getDate());
        buckets.push({ from, to, label });
    }
    return buckets;
}

// ---------- loading from supabase ----------

// one query per table covers both the current and the previous period
async function loadReport(range, prev) {
    const from = prev.start.toISOString();
    const to = range.end.toISOString();

    const [jobs, customers, missed, salesRows, statusCounts] = await Promise.all([
        supabase
            .from("jobs")
            .select("job_id, registered_at, delivered_at")
            .gte("delivered_at", from)
            .lt("delivered_at", to),
        supabase
            .from("customers")
            .select("customer_id, created_at")
            .gte("created_at", from)
            .lt("created_at", to),
        supabase
            .from("appointments")
            .select("appointment_id, customer_id, vehicle_id, contact_number, service_requested, appointment_datetime, customers(customer_id, full_name), vehicles(make, model, year)")
            .eq("status", "missed")
            .gte("appointment_datetime", from)
            .lt("appointment_datetime", to)
            .order("appointment_datetime", { ascending: false }),
        supabase
            .from("sales_records")
            .select("sale_id, amount_paid, payment_date, job_photos(storage_path), jobs(job_id, customers(full_name), vehicles(make, model, year, plate_number))")
            .gte("payment_date", isoDate(prev.start))
            .lt("payment_date", isoDate(range.end))
            .order("payment_date", { ascending: false }),
        supabase.from("v_job_status_counts").select("status, job_count"),
    ]);

    const failed = [jobs, customers, missed, salesRows, statusCounts].find((r) => r.error);
    if (failed) {
        console.error("Could not load the report:", failed.error);
        return null;
    }

    return {
        jobs: jobs.data,
        customers: customers.data,
        missed: missed.data,
        sales: salesRows.data,
        statusCounts: statusCounts.data,
    };
}

// signed links, because the photo bucket is private
async function attachReceiptUrls(rows) {
    const paths = rows.map((s) => s.job_photos?.storage_path).filter(Boolean);
    if (!paths.length) return rows;

    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 60 * 60);
    if (error) {
        console.error("Could not get receipt links:", error);
        return rows;
    }
    const byPath = new Map(data.map((d) => [d.path, d.signedUrl]));
    return rows.map((s) => ({ ...s, receiptUrl: byPath.get(s.job_photos?.storage_path) ?? null }));
}

// a missed appointment counts as rebooked when the same customer has an upcoming
// scheduled appointment for the same service (there's no column linking the two)
async function loadRebooked(missed) {
    const ids = [...new Set(missed.map((a) => a.customer_id))];
    if (!ids.length) return new Map();

    const { data, error } = await supabase
        .from("appointments")
        .select("customer_id, service_requested, appointment_datetime")
        .in("customer_id", ids)
        .eq("status", "scheduled")
        .gte("appointment_datetime", new Date().toISOString())
        .order("appointment_datetime");

    if (error) {
        console.error("Could not check for rebooked appointments:", error);
        return new Map();
    }

    const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const found = new Map();
    missed.forEach((m) => {
        const next = data.find((u) => u.customer_id === m.customer_id && same(u.service_requested, m.service_requested));
        if (next) found.set(m.appointment_id, next.appointment_datetime);
    });
    return found;
}

// ---------- summary cards ----------

// e.g. "+3 vs last week"; lowerIsBetter flips the colour for turnaround
function changeNote(id, now, before, { lowerIsBetter = false, format = (n) => n } = {}) {
    const el = $(id);
    const words = periodWords[period];

    if (now === null || before === null) {
        el.textContent = before === null ? `Nothing to compare with ${words}` : `Was ${format(before)} ${words}`;
        el.className = "mt-auto pt-3 border-t border-line text-[11px] text-muted";
        return;
    }

    const diff = Math.round((now - before) * 10) / 10;
    const better = lowerIsBetter ? diff < 0 : diff > 0;
    const tone = diff === 0 ? "text-muted" : better ? "text-status-delivered" : "text-status-overdue";
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";

    el.textContent = diff === 0 ? `Same as ${words}` : `${sign}${format(Math.abs(diff))} vs ${words}`;
    el.className = `mt-auto pt-3 border-t border-line text-[11px] font-semibold ${tone}`;
}

function renderStats(now, before) {
    $("stat-completed").textContent = now.completed.length;
    $("stat-customers").textContent = now.customers.length;
    $("stat-turnaround").textContent = now.turnaround ?? "—";
    $("stat-missed").textContent = now.missed.length;
    $("stat-revenue").textContent = formatMoney(now.revenue);

    changeNote("change-completed", now.completed.length, before.completed.length);
    changeNote("change-customers", now.customers.length, before.customers.length);
    changeNote("change-turnaround", now.turnaround, before.turnaround, { lowerIsBetter: true, format: (n) => `${n} days` });
    changeNote("change-missed", now.missed.length, before.missed.length, { lowerIsBetter: true });
    changeNote("change-revenue", now.revenue, before.revenue, { format: formatMoney });
}

// ---------- jobs chart ----------

function renderChart(range, completed) {
    const buckets = bucketsFor(range).map((b) => ({
        ...b,
        count: completed.filter((j) => {
            const t = new Date(j.delivered_at);
            return t >= b.from && t < b.to;
        }).length,
    }));

    const max = Math.max(1, ...buckets.map((b) => b.count));
    const busiest = buckets.reduce((top, b) => (b.count > top.count ? b : top), buckets[0]);
    // a month has up to 31 bars, so only every few days gets a label
    const labelEvery = period === "month" ? 5 : 1;

    $("chart-summary").textContent = completed.length
        ? `${completed.length} completed · busiest: ${busiest.label} (${busiest.count})`
        : "No jobs completed in this period";

    $("jobs-chart").innerHTML = buckets
        .map((b, i) => `
        <div class="flex-1 min-w-0 h-full flex flex-col items-center justify-end gap-1" title="${b.label}: ${b.count} job${b.count === 1 ? "" : "s"}">
            <span class="text-[10px] text-muted tabular-nums">${b.count || ""}</span>
            <div class="w-full max-w-10 rounded-t bg-accent/80" style="height: ${(b.count / max) * 80}%"></div>
            <span class="text-[10px] text-muted h-3">${i % labelEvery === 0 ? b.label : ""}</span>
        </div>`)
        .join("");
}

// ---------- status breakdown ----------

function renderStatusBreakdown(rows) {
    const counts = Object.fromEntries(rows.map((r) => [r.status, r.job_count]));
    const total = rows.reduce((sum, r) => sum + r.job_count, 0);
    $("status-total").textContent = total;

    // ring drawn with a conic gradient, one slice per status
    let at = 0;
    const slices = Object.entries(statuses)
        .filter(([key]) => counts[key])
        .map(([key, s]) => {
            const from = at;
            at += (counts[key] / total) * 100;
            return `${s.colour} ${from}% ${at}%`;
        });
    $("status-donut").style.background = slices.length ? `conic-gradient(${slices.join(", ")})` : "";

    $("status-list").innerHTML = Object.entries(statuses)
        .map(([key, s]) => {
            const n = counts[key] ?? 0;
            const pct = total ? Math.round((n / total) * 100) : 0;
            return `
            <li class="flex items-center justify-between gap-2">
                <span class="pill ${s.pill}"><span class="size-1.5 rounded-full bg-current"></span>${s.label}</span>
                <span class="tabular-nums text-muted"><strong class="text-ink">${n}</strong> · ${pct}%</span>
            </li>`;
        })
        .join("");
}

// ---------- tables ----------

function messageRow(bodyId, cols, text) {
    $(bodyId).innerHTML = `<tr><td colspan="${cols}" class="p-8 text-center text-muted">${text}</td></tr>`;
}

function renderSales(rows, total) {
    $("sales-total").textContent = formatMoneyShort(total);
    $("sales-count").textContent = `${rows.length} job${rows.length === 1 ? "" : "s"}`;

    if (!rows.length) {
        messageRow("sales-body", 6, "No sales recorded in this period.");
        return;
    }

    $("sales-body").innerHTML = rows
        .map((s) => {
            const job = s.jobs;
            const receipt = s.receiptUrl
                ? `<a href="${s.receiptUrl}" target="_blank" rel="noopener" class="text-xs font-semibold text-accent hover:underline">View</a>`
                : `<span class="text-xs text-muted">—</span>`;
            return `
            <tr class="odd:bg-row even:bg-row-alt">
                <td class="px-5 py-4 text-sm">${formatDate(parseDay(s.payment_date))}</td>
                <td class="px-5 py-4">
                    <a href="/pages/jobs.html?job=${job.job_id}" class="font-mono text-xs font-semibold text-accent hover:underline">#${jobNumber(job.job_id)}</a>
                </td>
                <td class="px-5 py-4 text-sm">${escapeHtml(job.customers?.full_name ?? "—")}</td>
                <td class="px-5 py-4 text-sm">
                    ${escapeHtml(vehicleName(job.vehicles))}
                    ${job.vehicles?.plate_number ? `<span class="plate ml-2">${escapeHtml(job.vehicles.plate_number)}</span>` : ""}
                </td>
                <td class="px-5 py-4 text-sm text-right font-mono tabular-nums">${formatMoney(s.amount_paid)}</td>
                <td class="px-5 py-4 text-right print:hidden">${receipt}</td>
            </tr>`;
        })
        .join("");
}

// ---------- revenue trend chart ----------

// e.g. GYD 168K, GYD 1.2M (for chart labels where space is tight)
function formatMoneyTiny(amount) {
    if (amount >= 1_000_000) return `GYD ${Math.round(amount / 100_000) / 10}M`;
    if (amount >= 1_000) return `GYD ${Math.round(amount / 1_000)}K`;
    return `GYD ${Math.round(amount)}`;
}

// day labels for the chart, e.g. 26 Oct
const shortDay = (date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function renderRevenueChart(range, rows) {
    const buckets = bucketsFor(range).map((b) => {
        const total = rows
            .filter((s) => {
                const day = parseDay(s.payment_date);
                return day >= b.from && day < b.to;
            })
            .reduce((sum, s) => sum + Number(s.amount_paid), 0);
        // the year view already labels by month; days get "26 Oct" like the table
        const name = period === "year" ? b.label : shortDay(b.from);
        return { ...b, total, name };
    });

    if (!rows.length) {
        $("revenue-chart").innerHTML = `<p class="h-full flex items-center justify-center text-sm text-muted">No sales recorded in this period.</p>`;
        $("revenue-labels").innerHTML = "";
        return;
    }

    const max = Math.max(1, ...buckets.map((b) => b.total));
    const peak = buckets.findIndex((b) => b.total === max);
    const last = buckets.length - 1;

    // positions are percentages of the chart box; 8% of space is kept at the top and bottom
    const x = (i) => (last ? (i / last) * 100 : 50);
    const y = (total) => 92 - (total / max) * 84;

    // days that haven't happened yet keep their label but get no point
    const today = new Date();
    const drawn = buckets.filter((b) => b.from <= today);
    const lastDrawn = drawn.length - 1;

    const points = drawn.map((b, i) => `${x(i)},${y(b.total)}`);
    const line = `M ${points.join(" L ")}`;
    const area = `${line} L ${x(lastDrawn)},100 L ${x(0)},100 Z`;

    // the svg stretches to fill the box, so the stroke is kept from stretching with it
    const svg = `
        <svg class="absolute inset-0 size-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs>
                <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="var(--color-accent)" stop-opacity="0.35" />
                    <stop offset="100%" stop-color="var(--color-accent)" stop-opacity="0" />
                </linearGradient>
            </defs>
            <path d="${area}" fill="url(#revenue-fill)" />
            <path d="${line}" fill="none" stroke="var(--color-accent-hover)" stroke-width="3"
                stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
        </svg>`;

    // dots are html so they stay round when the svg stretches; the best day gets a bigger dot
    const dots = drawn
        .map((b, i) => {
            const size = i === peak ? "size-4" : "size-2.5";
            return `<span class="absolute ${size} -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-hover"
                style="left: ${x(i)}%; top: ${y(b.total)}%" title="${b.name}: ${formatMoney(b.total)}"></span>`;
        })
        .join("");

    $("revenue-chart").innerHTML = svg + dots;

    // a month has up to 31 points, so only every 5th day is labelled; the week view also shows the amount
    const labelEvery = period === "month" ? 5 : 1;
    $("revenue-labels").innerHTML = buckets
        .map((b, i) => {
            if (i % labelEvery !== 0 && i !== last) return "";
            const amount = period === "week" && b.total ? ` (${formatMoneyTiny(b.total)})` : "";
            // first and last labels line up with the edges so they don't hang off the card
            const shift = i === 0 ? "" : i === last ? "-translate-x-full" : "-translate-x-1/2";
            return `<span class="absolute ${shift} whitespace-nowrap text-[11px] font-semibold uppercase text-muted" style="left: ${x(i)}%">${b.name}${amount}</span>`;
        })
        .join("");
}

// table or chart, remembered while the user flips through periods
let salesView = "table";

function setSalesView(view) {
    salesView = view;
    $("sales-table-view").classList.toggle("hidden", view !== "table");
    $("sales-chart-view").classList.toggle("hidden", view !== "chart");

    document.querySelectorAll("#sales-views [data-view]").forEach((btn) => {
        const selected = btn.dataset.view === view;
        btn.setAttribute("aria-pressed", String(selected));
        btn.classList.toggle("bg-raised", selected);
        btn.classList.toggle("text-accent", selected);
        btn.classList.toggle("text-muted", !selected);
        btn.classList.toggle("hover:text-ink", !selected);
    });
}

// both missed appointment buttons share one look: grey fill, teal on hover
const actionButton =
    "inline-flex items-center gap-1.5 rounded-lg bg-raised px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-ink transition hover:bg-accent hover:text-neutral-950";

const phoneIcon = `<svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.25 1.01z"/></svg>`;

// calendar with a plus
const rescheduleIcon = `<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8"/><path d="M16 2v4M8 2v4M3 10h18M19 16v6M16 19h6"/></svg>`;

function renderMissed(rows) {
    $("missed-summary").textContent = rows.length ? `${rows.length} missed` : "";

    if (!rows.length) {
        messageRow("missed-body", 4, "No missed appointments in this period.");
        return;
    }

    $("missed-body").innerHTML = rows
        .map((a) => `
        <tr class="odd:bg-row even:bg-row-alt">
            <td class="px-5 py-4">
                <p class="text-sm font-semibold">${escapeHtml(a.customers?.full_name ?? "—")}</p>
                <p class="text-xs text-muted">${escapeHtml(a.contact_number)}</p>
            </td>
            <td class="px-5 py-4 text-sm">${formatDateTime(a.appointment_datetime)}</td>
            <td class="px-5 py-4">
                <p class="text-sm">${escapeHtml(a.service_requested)}</p>
                <p class="text-xs text-muted">${escapeHtml(vehicleName(a.vehicles))}</p>
            </td>
            <td class="px-5 py-4 text-right whitespace-nowrap print:hidden">
                <div class="inline-flex gap-2">
                    <a href="tel:${escapeHtml(a.contact_number.replace(/[^0-9+]/g, ""))}" class="${actionButton}">
                        ${phoneIcon} Contact
                    </a>
                    ${rebooked.has(a.appointment_id)
                        ? `<span class="pill status-delivered" title="Booked for ${formatDateTime(rebooked.get(a.appointment_id))}">${rescheduleIcon} Rebooked ${formatDate(rebooked.get(a.appointment_id))}</span>`
                        : `<button type="button" data-reschedule="${a.appointment_id}" class="${actionButton} cursor-pointer">${rescheduleIcon} Reschedule</button>`}
                </div>
            </td>
        </tr>`)
        .join("");
}

// ---------- putting it together ----------

function renderPeriodTabs() {
    document.querySelectorAll("#period-tabs [data-period]").forEach((btn) => {
        const selected = btn.dataset.period === period;
        btn.setAttribute("aria-pressed", String(selected));
        btn.classList.toggle("bg-accent", selected);
        btn.classList.toggle("text-neutral-950", selected);
        btn.classList.toggle("bg-inset", !selected);
        btn.classList.toggle("text-ink/75", !selected);
        btn.classList.toggle("hover:bg-raised", !selected);
    });
}

async function refresh() {
    const thisLoad = ++loadCount;
    const range = rangeFor(anchor, period);
    const prev = previousRange(range, period);

    renderPeriodTabs();
    $("period-label").textContent = periodLabel(range);
    // can't go past the period we're in now
    $("next-btn").disabled = range.end > new Date();

    const data = await loadReport(range, prev);
    if (thisLoad !== loadCount) return; // the user picked another period while this was loading

    if (!data) {
        $("report-error").textContent = "Couldn't load the report. Refresh the page to try again.";
        $("report-error").classList.remove("hidden");
        messageRow("sales-body", 6, "No sales to show.");
        messageRow("missed-body", 4, "No appointments to show.");
        return;
    }
    $("report-error").classList.add("hidden");

    // splits rows into this period and the one before, using the given date column
    const split = (rows, pick) => {
        const now = [];
        const before = [];
        rows.forEach((r) => (pick(r) >= range.start ? now : before).push(r));
        return { now, before };
    };

    const completed = split(data.jobs, (j) => new Date(j.delivered_at));
    const customers = split(data.customers, (c) => new Date(c.created_at));
    const missed = split(data.missed, (a) => new Date(a.appointment_datetime));
    const paid = split(data.sales, (s) => parseDay(s.payment_date));
    const sum = (rows) => rows.reduce((total, s) => total + Number(s.amount_paid), 0);

    const now = {
        completed: completed.now,
        customers: customers.now,
        turnaround: averageTurnaround(completed.now),
        missed: missed.now,
        revenue: sum(paid.now),
    };
    const before = {
        completed: completed.before,
        customers: customers.before,
        turnaround: averageTurnaround(completed.before),
        missed: missed.before,
        revenue: sum(paid.before),
    };

    [sales, rebooked] = await Promise.all([attachReceiptUrls(paid.now), loadRebooked(now.missed)]);
    if (thisLoad !== loadCount) return;
    missedRows = now.missed;

    renderStats(now, before);
    renderChart(range, now.completed);
    renderStatusBreakdown(data.statusCounts);
    renderSales(sales, now.revenue);
    renderRevenueChart(range, sales);
    renderMissed(now.missed);
}

// ---------- export and print ----------

// wraps a value in quotes so commas and quotes inside it don't break the csv
const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

function exportSales() {
    if (!sales.length) {
        showToast("Nothing to export", "There are no sales in this period.", "error");
        return;
    }

    const header = ["Payment date", "Job", "Customer", "Vehicle", "Plate", "Amount paid (GYD)"];
    const lines = sales.map((s) => [
        s.payment_date,
        jobNumber(s.jobs.job_id),
        s.jobs.customers?.full_name,
        vehicleName(s.jobs.vehicles),
        s.jobs.vehicles?.plate_number,
        Number(s.amount_paid).toFixed(2),
    ]);

    const csv = [header, ...lines].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `sales-${isoDate(rangeFor(anchor, period).start)}-${period}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

// prints in light mode without the sidebar and top bar, then puts everything back
function printReport() {
    const html = document.documentElement;
    const theme = html.dataset.theme;
    const chrome = [document.getElementById("sidebar"), document.getElementById("topbar")].filter(Boolean);

    html.dataset.theme = "light";
    chrome.forEach((el) => el.classList.add("hidden"));
    document.body.classList.remove("md:pl-16");
    $("generated-note").textContent = `Generated ${formatDateTime(new Date())} by ${me?.full_name ?? "admin"} · Fred's Auto Electrical`;

    window.addEventListener("afterprint", () => {
        html.dataset.theme = theme;
        chrome.forEach((el) => el.classList.remove("hidden"));
        document.body.classList.add("md:pl-16");
    }, { once: true });

    window.print();
}

// ---------- reschedule modal ----------

// value for a datetime-local input, in local time, e.g. 2026-11-21T10:00
function toLocalInput(date) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

// tomorrow at 9:00 am, a sensible starting point for a new booking
function defaultSlot() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
}

function showModalMessage(text) {
    $("rs-message").textContent = text;
    $("rs-message").classList.toggle("hidden", !text);
}

function openReschedule(id) {
    rescheduling = missedRows.find((a) => a.appointment_id === id);
    if (!rescheduling) return;
    lastFocused = document.activeElement;

    $("rs-customer").textContent = rescheduling.customers?.full_name ?? "Unknown customer";
    $("rs-vehicle").textContent = vehicleName(rescheduling.vehicles);
    $("rs-missed").textContent = `Missed: ${formatDateTime(rescheduling.appointment_datetime)}`;
    $("rs-when").min = toLocalInput(new Date());
    $("rs-when").value = toLocalInput(defaultSlot());
    $("rs-service").value = rescheduling.service_requested;
    $("rs-phone").value = rescheduling.contact_number;
    showModalMessage("");
    $("rs-save").disabled = false;

    $("reschedule-modal").classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
    // next frame so the fade-in transition actually runs
    requestAnimationFrame(() => {
        $("reschedule-modal").querySelector("[data-modal-backdrop]").classList.replace("opacity-0", "opacity-100");
        $("reschedule-box").classList.remove("opacity-0", "scale-95");
    });
    $("rs-when").focus();
}

// force skips the "still saving" check, for closing right after a save
function closeReschedule(force = false) {
    if (!rescheduling || (!force && $("rs-save").disabled)) return;

    $("reschedule-modal").querySelector("[data-modal-backdrop]").classList.replace("opacity-100", "opacity-0");
    $("reschedule-box").classList.add("opacity-0", "scale-95");
    document.body.classList.remove("overflow-hidden");
    rescheduling = null;
    setTimeout(() => {
        if (!rescheduling) $("reschedule-modal").classList.add("hidden");
    }, 200);
    lastFocused?.focus?.();
}

// the missed row stays as it is (so the report still counts it) and a new scheduled one is added
async function saveReschedule(event) {
    event.preventDefault();
    const when = new Date($("rs-when").value);
    const service = $("rs-service").value.trim();
    const phone = $("rs-phone").value.trim();

    if (Number.isNaN(when.getTime()) || when <= new Date()) {
        showModalMessage("Pick a date and time in the future.");
        return;
    }
    if (!service) {
        showModalMessage("Enter the service requested.");
        return;
    }

    $("rs-save").disabled = true;
    showModalMessage("");

    const { error } = await supabase.from("appointments").insert({
        customer_id: rescheduling.customer_id,
        vehicle_id: rescheduling.vehicle_id,
        contact_number: phone,
        service_requested: service,
        appointment_datetime: when.toISOString(),
        created_by: me.profile_id,
    });

    if (error) {
        console.error("Could not book the appointment:", error);
        $("rs-save").disabled = false;
        // 23514 is a check constraint, here the phone number format
        showModalMessage(error.code === "23514" ? "That contact number doesn't look right." : "Couldn't book the appointment. Check your connection and try again.");
        return;
    }

    const name = rescheduling.customers?.full_name ?? "";
    closeReschedule(true);
    showToast("Appointment booked", `${name} · ${formatDateTime(when)}`);
    refresh();
}

function setupRescheduleModal() {
    // one listener on the table body for every reschedule button
    $("missed-body").addEventListener("click", (event) => {
        const btn = event.target.closest("[data-reschedule]");
        if (btn) openReschedule(btn.dataset.reschedule);
    });

    $("reschedule-modal").addEventListener("click", (event) => {
        if (event.target.closest("[data-modal-close], [data-modal-backdrop]")) closeReschedule();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && rescheduling) closeReschedule();
    });
    $("reschedule-form").addEventListener("submit", saveReschedule);
}

// ---------- export menu ----------

function setExportMenu(open) {
    $("export-menu").classList.toggle("hidden", !open);
    $("export-btn").setAttribute("aria-expanded", String(open));
    $("export-arrow").classList.toggle("rotate-180", open);
    if (open) $("export-menu").querySelector("[data-export]").focus();
}

function setupExportMenu() {
    const isOpen = () => !$("export-menu").classList.contains("hidden");

    $("export-btn").addEventListener("click", () => setExportMenu(!isOpen()));

    $("export-menu").addEventListener("click", (event) => {
        const choice = event.target.closest("[data-export]")?.dataset.export;
        if (!choice) return;
        setExportMenu(false);
        if (choice === "pdf") printReport();
        else exportSales();
    });

    // clicking anywhere else closes it
    document.addEventListener("click", (event) => {
        if (isOpen() && !$("export-wrap").contains(event.target)) setExportMenu(false);
    });

    // escape closes it and puts focus back on the button
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && isOpen()) {
            setExportMenu(false);
            $("export-btn").focus();
        }
    });
}

// ---------- start ----------

async function main() {
    const page = await initPage({ active: "reports", adminOnly: true });
    if (!page) return;
    me = page.profile;

    document.querySelectorAll("#period-tabs [data-period]").forEach((btn) =>
        btn.addEventListener("click", () => {
            period = btn.dataset.period;
            anchor = new Date(); // jump back to the current period
            refresh();
        }),
    );
    $("prev-btn").addEventListener("click", () => {
        shiftAnchor(-1);
        refresh();
    });
    $("next-btn").addEventListener("click", () => {
        shiftAnchor(1);
        refresh();
    });
    setupExportMenu();
    document.querySelectorAll("#sales-views [data-view]").forEach((btn) =>
        btn.addEventListener("click", () => setSalesView(btn.dataset.view)),
    );
    setSalesView(salesView);
    setupRescheduleModal();

    await refresh();
}

main();