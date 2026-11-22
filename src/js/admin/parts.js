// parts alerts page (admins only)
// add, edit, deactivate and reactivate parts, and see which parts are being used a lot
// usage is counted from job_parts on jobs registered inside each part's alert period,
// the same rule the v_restock_alerts view uses

import { supabase } from "../lib/supabase.js";
import { initPage } from "../shared/page.js";
import { showToast } from "../shared/toast.js";
import { confirmDialog, isConfirmOpen } from "../shared/confirm-dialog.js";

let parts = [];          // every part, with a `used` count added
let editing = null;      // the part being edited, or null when adding
let isModalOpen = false;
let isSaving = false;
let lastFocused = null;

const $ = (id) => document.getElementById(id);

// text from the database gets escaped before it goes into html
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text ?? "";
    return div.innerHTML;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// alert = over the limit, ok = under it, none = no limit set, inactive = switched off
function statusOf(part) {
    if (!part.is_active) return "inactive";
    if (part.alert_threshold === null) return "none";
    return part.used >= part.alert_threshold ? "alert" : "ok";
}

// ---------- loading ----------

async function loadParts() {
    const { data, error } = await supabase
        .from("parts")
        .select("part_id, part_name, alert_threshold, alert_period_days, is_active")
        .order("part_name");

    if (error) {
        console.error("Could not load parts:", error);
        showError("Couldn't load parts. Refresh the page to try again.");
        return false;
    }

    // one query for usage, going back as far as the longest period
    const longest = Math.max(30, ...data.map((p) => p.alert_period_days));
    const since = new Date(Date.now() - longest * 86400000);

    const usage = await supabase
        .from("job_parts")
        .select("part_id, quantity, jobs!inner(registered_at)")
        .gte("jobs.registered_at", since.toISOString());

    if (usage.error) {
        console.error("Could not load part usage:", usage.error);
        showError("Couldn't load how often parts were used. Refresh the page to try again.");
        return false;
    }

    // each part only counts jobs inside its own period
    parts = data.map((part) => {
        const start = Date.now() - part.alert_period_days * 86400000;
        const used = usage.data
            .filter((u) => u.part_id === part.part_id && new Date(u.jobs.registered_at) >= start)
            .reduce((sum, u) => sum + u.quantity, 0);
        return { ...part, used };
    });

    hideError();
    return true;
}

function showError(text) {
    $("parts-error").textContent = text;
    $("parts-error").classList.remove("hidden");
}

function hideError() {
    $("parts-error").classList.add("hidden");
}

// ---------- needs restocking ----------

function renderRestock() {
    const over = parts
        .filter((p) => statusOf(p) === "alert")
        .sort((a, b) => (b.used - b.alert_threshold) - (a.used - a.alert_threshold));

    const badge = $("restock-badge");
    badge.classList.remove("hidden");
    badge.textContent = over.length ? `${plural(over.length, "part")} over limit` : "All good";
    badge.className = over.length
        ? "rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide bg-status-overdue/15 text-status-overdue border border-status-overdue/30"
        : "rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide bg-accent/15 text-accent border border-accent/30";

    $("restock-card").classList.toggle("border-status-overdue/40", over.length > 0);

    if (!over.length) {
        $("restock-list").className = "rounded-xl border border-line overflow-hidden";
        $("restock-list").innerHTML = `
            <li class="p-6 flex flex-col items-center text-center gap-2">
                <span class="size-10 rounded-full bg-accent/15 text-accent border border-accent/30 flex items-center justify-center">
                    <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>
                </span>
                <p class="text-sm font-semibold">No parts need restocking.</p>
                <p class="text-xs text-muted">Every part with an alert limit is under it.</p>
            </li>`;
        return;
    }

    $("restock-list").className = "divide-y divide-line rounded-xl border border-status-overdue/30 overflow-hidden";
    $("restock-list").innerHTML = over
        .map((p) => `
        <li class="flex flex-wrap items-center justify-between gap-3 p-4 bg-status-overdue/5">
            <div class="flex items-center gap-3 min-w-0">
                <span class="size-9 shrink-0 rounded-lg bg-status-overdue/15 text-status-overdue border border-status-overdue/30 flex items-center justify-center">
                    <svg class="size-4.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
                </span>
                <span class="font-semibold truncate">${escapeHtml(p.part_name)}</span>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-sm">
                <span class="rounded-lg bg-raised px-3 py-1.5"><span class="text-muted">Used:</span> <strong class="text-status-overdue">${p.used} in ${p.alert_period_days}d</strong></span>
                <span class="rounded-lg bg-raised px-3 py-1.5"><span class="text-muted">Limit:</span> <strong>${p.alert_threshold}</strong></span>
                <span class="pill status-overdue">${p.used === p.alert_threshold ? "At limit" : `+${p.used - p.alert_threshold} over`}</span>
            </div>
        </li>`)
        .join("");
}

// ---------- parts table ----------

// pill for each status; class names are written out in full so tailwind can find them
const statusPill = {
    alert: `<span class="pill status-overdue"><span class="size-1.5 rounded-full bg-current animate-pulse"></span>Alert</span>`,
    ok: `<span class="pill status-delivered"><span class="size-1.5 rounded-full bg-current"></span>OK</span>`,
    none: `<span class="pill bg-raised text-muted">No alert set</span>`,
    inactive: `<span class="pill bg-raised text-muted">Inactive</span>`,
};

// both action buttons share one look: grey fill, teal on hover
const actionButton =
    "inline-flex items-center gap-1.5 rounded-lg bg-raised px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-ink transition hover:bg-accent hover:text-neutral-950 cursor-pointer disabled:opacity-50";

function renderTable() {
    const showInactive = $("show-inactive").checked;
    const search = $("parts-search").value.trim().toLowerCase();
    const inactiveCount = parts.filter((p) => !p.is_active).length;
    $("inactive-count").textContent = inactiveCount ? `(${inactiveCount})` : "";

    // no parts at all: show the first use panel instead of the table
    const firstUse = parts.length === 0;
    $("first-use").classList.toggle("hidden", !firstUse);
    $("first-use").classList.toggle("flex", firstUse);
    $("parts-table-wrap").classList.toggle("hidden", firstUse);
    if (firstUse) return;

    // alerts first, then by name
    const order = { alert: 0, ok: 1, none: 2, inactive: 3 };
    const rows = parts
        .filter((p) => showInactive || p.is_active)
        .filter((p) => p.part_name.toLowerCase().includes(search))
        .sort((a, b) => order[statusOf(a)] - order[statusOf(b)] || a.part_name.localeCompare(b.part_name));

    if (!rows.length) {
        const why = search ? "No parts match your search." : "Every part is inactive. Turn on \"Show inactive parts\" to see them.";
        $("parts-body").innerHTML = `<tr><td colspan="6" class="p-8 text-center text-muted">${why}</td></tr>`;
        return;
    }

    $("parts-body").innerHTML = rows
        .map((p) => {
            const status = statusOf(p);
            const inactive = status === "inactive";
            const toggle = inactive
                ? `<button type="button" data-action="reactivate" data-id="${p.part_id}" class="${actionButton}">Reactivate</button>`
                : `<button type="button" data-action="deactivate" data-id="${p.part_id}" class="${actionButton}">Deactivate</button>`;
            return `
            <tr class="odd:bg-row even:bg-row-alt ${inactive ? "opacity-60" : ""}">
                <td class="px-5 py-4 text-sm font-semibold ${inactive ? "line-through text-muted" : ""}">${escapeHtml(p.part_name)}</td>
                <td class="px-5 py-4 text-sm ${status === "alert" ? "font-semibold text-status-overdue" : ""}">${p.used} in last ${p.alert_period_days} days</td>
                <td class="px-5 py-4 text-sm ${p.alert_threshold === null ? "text-muted" : ""}">${p.alert_threshold ?? "—"}</td>
                <td class="px-5 py-4 text-sm text-muted">${plural(p.alert_period_days, "day")}</td>
                <td class="px-5 py-4">${statusPill[status]}</td>
                <td class="px-5 py-4 text-right whitespace-nowrap">
                    <div class="inline-flex gap-2">
                        <button type="button" data-action="edit" data-id="${p.part_id}" class="${actionButton}">Edit</button>
                        ${toggle}
                    </div>
                </td>
            </tr>`;
        })
        .join("");
}

function renderAll() {
    renderRestock();
    renderTable();
}

// ---------- deactivate / reactivate ----------

async function setActive(part, active) {
    if (!active) {
        const sure = await confirmDialog({
            title: "Deactivate this part?",
            message: `${part.part_name} won't be available for new jobs. Past jobs keep their records, and you can reactivate it later.`,
            confirmLabel: "Deactivate",
        });
        if (!sure) return;
    }

    const { error } = await supabase.from("parts").update({ is_active: active }).eq("part_id", part.part_id);
    if (error) {
        console.error("Could not change the part:", error);
        showToast("Couldn't update the part", "Please try again.", "error");
        return;
    }

    part.is_active = active;
    showToast(active ? "Part reactivated" : "Part deactivated", part.part_name);
    renderAll();
}

// ---------- add / edit modal ----------

// reads the form; limit is null when left empty
function readForm() {
    const limitText = $("part-limit").value.trim();
    return {
        name: $("part-name").value.trim().replace(/\s+/g, " "),
        limit: limitText === "" ? null : Number(limitText),
        period: Number($("part-period").value),
        active: $("part-active").checked,
    };
}

const isWholeNumber = (n, min, max = Infinity) => Number.isInteger(n) && n >= min && n <= max;

// "alert me if alternator is used 5 or more times in 30 days", built with text nodes so names stay safe
function renderPreview() {
    const { name, limit, period, active } = readForm();
    const preview = $("rule-preview");
    preview.replaceChildren();

    const strong = (text) => {
        const span = document.createElement("span");
        span.className = "font-semibold text-accent";
        span.textContent = text;
        return span;
    };

    if (!active) {
        preview.append("This part is inactive, so it won't trigger alerts or show up for new jobs.");
    } else if (limit === null || !isWholeNumber(limit, 1)) {
        preview.append("No alert will be triggered for this part.");
    } else {
        preview.append(
            "Alert me if ", strong(name || "this part"),
            " is used ", strong(String(limit)),
            " or more times in ", strong(isWholeNumber(period, 1) ? String(period) : "—"),
            " days.",
        );
    }
}

function setFieldError(id, show, text) {
    $(id).classList.toggle("hidden", !show);
    if (text) $(id).textContent = text;
}

// checks the form and shows messages under the fields; returns true when it's ok to save
function validate() {
    const { name, limit, period } = readForm();
    let ok = true;

    const taken = parts.some(
        (p) => p.part_name.toLowerCase() === name.toLowerCase() && p.part_id !== editing?.part_id,
    );
    if (!name) {
        setFieldError("name-error", true, "Enter a part name");
        ok = false;
    } else if (taken) {
        setFieldError("name-error", true, "A part with this name already exists");
        ok = false;
    } else {
        setFieldError("name-error", false);
    }

    const limitOk = limit === null || isWholeNumber(limit, 1);
    setFieldError("limit-error", !limitOk);
    const periodOk = isWholeNumber(period, 1, 365);
    setFieldError("period-error", !periodOk);

    return ok && limitOk && periodOk;
}

function openModal(part = null, prefill = {}) {
    if (isModalOpen) return;
    lastFocused = document.activeElement;
    editing = part;

    $("part-form").reset();
    ["name-error", "limit-error", "period-error", "form-error"].forEach((id) => $(id).classList.add("hidden"));
    $("part-modal-title").textContent = part ? "Edit part" : "Add part";
    $("save-part-btn").textContent = part ? "Save changes" : "Save part";

    $("part-name").value = part?.part_name ?? prefill.name ?? "";
    $("part-limit").value = part?.alert_threshold ?? prefill.limit ?? "";
    $("part-period").value = part?.alert_period_days ?? prefill.period ?? 30;
    $("part-active").checked = part ? part.is_active : true;
    renderPreview();

    $("part-modal").classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
    // next frame so the fade-in transition actually runs
    requestAnimationFrame(() => {
        $("part-modal").querySelector("[data-modal-backdrop]").classList.replace("opacity-0", "opacity-100");
        $("part-box").classList.remove("opacity-0", "scale-95");
    });
    isModalOpen = true;
    $("part-name").focus();
}

function closeModal() {
    // don't close while saving
    if (!isModalOpen || isSaving) return;

    $("part-modal").querySelector("[data-modal-backdrop]").classList.replace("opacity-100", "opacity-0");
    $("part-box").classList.add("opacity-0", "scale-95");
    document.body.classList.remove("overflow-hidden");
    isModalOpen = false;
    setTimeout(() => {
        if (!isModalOpen) $("part-modal").classList.add("hidden");
    }, 200);
    lastFocused?.focus?.();
}

async function savePart(event) {
    event.preventDefault();
    if (isSaving || !validate()) return;

    const { name, limit, period, active } = readForm();
    const row = { part_name: name, alert_threshold: limit, alert_period_days: period, is_active: active };

    isSaving = true;
    $("save-part-btn").disabled = true;
    $("save-part-btn").textContent = "Saving...";
    $("form-error").classList.add("hidden");

    const { error } = editing
        ? await supabase.from("parts").update(row).eq("part_id", editing.part_id)
        : await supabase.from("parts").insert(row);

    isSaving = false;
    $("save-part-btn").disabled = false;
    $("save-part-btn").textContent = editing ? "Save changes" : "Save part";

    if (error) {
        console.error("Could not save the part:", error);
        // 23505 is postgres's "already exists" error for the unique part name
        if (error.code === "23505") setFieldError("name-error", true, "A part with this name already exists");
        else setFieldError("form-error", true, "Couldn't save the part. Please try again.");
        return;
    }

    const wasEditing = Boolean(editing);
    closeModal();
    showToast(wasEditing ? "Part updated" : "Part added", name);
    if (await loadParts()) renderAll();
}

// ---------- events ----------

function setupEvents() {
    $("add-part-btn").addEventListener("click", () => openModal());
    $("first-add-btn").addEventListener("click", () => openModal());

    // quick start buttons open the form already filled in
    $("first-use").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-suggest]");
        if (!btn) return;
        openModal(null, { name: btn.dataset.suggest, limit: btn.dataset.limit, period: btn.dataset.period });
    });

    // edit, deactivate and reactivate (one listener on the table)
    $("parts-body").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-action]");
        if (!btn) return;
        const part = parts.find((p) => p.part_id === btn.dataset.id);
        if (!part) return;
        if (btn.dataset.action === "edit") openModal(part);
        else setActive(part, btn.dataset.action === "reactivate");
    });

    $("parts-search").addEventListener("input", renderTable);
    $("show-inactive").addEventListener("change", renderTable);

    // modal
    $("part-form").addEventListener("submit", savePart);
    $("part-form").addEventListener("input", renderPreview);
    $("part-modal").addEventListener("click", (e) => {
        if (e.target.closest("[data-modal-close]") || e.target.matches("[data-modal-backdrop]")) closeModal();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && isModalOpen && !isConfirmOpen()) closeModal();
    });
}

// ---------- start ----------

async function main() {
    // checks the login, loads the profile and draws the sidebar
    const page = await initPage({ active: "partsAlerts", adminOnly: true });
    if (!page) return;

    setupEvents();
    if (await loadParts()) renderAll();
}

main();