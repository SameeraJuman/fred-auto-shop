import { supabase } from '../lib/supabase.js';
import { initPage } from '../shared/page.js';
import { showToast } from '../shared/toast.js';

/* =========================================================
   APPOINTMENTS PAGE — FRED'S AUTO ELECTRICAL
   ========================================================= */

const STATUS_LABELS = {
    scheduled: 'Scheduled',
    completed: 'Completed',
    rescheduled: 'Rescheduled',
    cancelled: 'Cancelled',
    missed: 'Missed'
};

const STATUS_COLORS = {
    scheduled: 'var(--color-secondary-400)',
    completed: 'var(--color-primary-400)',
    rescheduled: 'var(--color-status-awaiting-parts)',
    cancelled: 'var(--color-status-overdue)',
    missed: 'var(--color-tertiary-400)'
};

const state = {
    appointments: [],
    customers: [],
    vehicles: [],
    filter: 'all',
    statusFilter: 'all',
    view: 'calendar',
    calendarMode: 'month',
    dateRange: 'month',
    currentDate: new Date(),
    selectedDate: null,
    userId: null,
    loading: false
};

const $ = (id) => document.getElementById(id);

/* =========================================================
   HELPERS
   ========================================================= */

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => {
        const entities = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };

        return entities[char];
    });
}

function formatDate(value, options = {}) {
    if (!value) return 'Not specified';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return 'Invalid date';
    }

    return new Intl.DateTimeFormat('en-US', options).format(date);
}

function sameDay(first, second) {
    return (
        first.getFullYear() === second.getFullYear() &&
        first.getMonth() === second.getMonth() &&
        first.getDate() === second.getDate()
    );
}

function getLocalDateTime(value) {
    const date = new Date(value);
    const pad = (number) => String(number).padStart(2, '0');

    return [
        date.getFullYear(),
        '-',
        pad(date.getMonth() + 1),
        '-',
        pad(date.getDate()),
        'T',
        pad(date.getHours()),
        ':',
        pad(date.getMinutes())
    ].join('');
}

function getCustomer(appointment) {
    return (
        appointment.customers ||
        state.customers.find(
            (customer) => customer.customer_id === appointment.customer_id
        ) ||
        null
    );
}

function getVehicle(appointment) {
    return (
        appointment.vehicles ||
        state.vehicles.find(
            (vehicle) => vehicle.vehicle_id === appointment.vehicle_id
        ) ||
        null
    );
}

function getVehicleName(vehicle) {
    if (!vehicle) return 'No vehicle selected';

    return [
        vehicle.year,
        vehicle.make,
        vehicle.model
    ].filter(Boolean).join(' ');
}

function getStatusBadge(status) {
    const label = STATUS_LABELS[status] || status;

    return `
        <span class="appointment-status ${escapeHtml(status)}">
            ${escapeHtml(label)}
        </span>
    `;
}

function showError(message) {
    showToast('Error', message, 'error');
}

function closeModal() {
    $('appointment-dialog-root').replaceChildren();
    document.body.style.overflow = '';
}

function openModal(html) {
    const root = $('appointment-dialog-root');

    root.innerHTML = html;
    document.body.style.overflow = 'hidden';

    const overlay = root.querySelector('.appointment-modal-overlay');

    overlay?.addEventListener('click', (event) => {
        if (event.target === overlay) {
            closeModal();
        }
    });

    root.querySelectorAll('[data-close-modal]').forEach((button) => {
        button.addEventListener('click', closeModal);
    });
}

/* =========================================================
   LOAD APPOINTMENTS
   ========================================================= */

async function loadAppointments() {
    state.loading = true;

    $('appointment-list').innerHTML = `
        <div class="card p-8 text-center text-muted">
            Loading appointments...
        </div>
    `;

    const { data, error } = await supabase
        .from('appointments')
        .select(`
            *,
            customers (
                customer_id,
                full_name,
                phone_number
            ),
            vehicles (
                vehicle_id,
                customer_id,
                year,
                make,
                model,
                plate_number
            )
        `)
        .order('appointment_datetime', {
            ascending: true
        });

    state.loading = false;

    if (error) {
        console.error('Failed to load appointments:', error);

        $('appointment-list').innerHTML = `
            <div class="appointment-empty">
                <h3 class="appointment-empty-title">
                    Unable to load appointments
                </h3>
                <p class="appointment-empty-description">
                    Please try again.
                </p>
                <button id="retry-appointments" class="btn btn-secondary">
                    Retry
                </button>
            </div>
        `;

        $('retry-appointments').addEventListener(
            'click',
            loadAppointments
        );

        showError(error.message);
        return;
    }

    state.appointments = data || [];

    renderPage();
}

/* =========================================================
   LOAD CUSTOMERS AND VEHICLES
   ========================================================= */

async function loadFormData() {
    const [customerResult, vehicleResult] = await Promise.all([
        supabase
            .from('customers')
            .select('customer_id, full_name, phone_number')
            .order('full_name'),

        supabase
            .from('vehicles')
            .select(`
                vehicle_id,
                customer_id,
                year,
                make,
                model,
                plate_number
            `)
            .order('make')
    ]);

    if (customerResult.error) {
        throw customerResult.error;
    }

    if (vehicleResult.error) {
        throw vehicleResult.error;
    }

    state.customers = customerResult.data || [];
    state.vehicles = vehicleResult.data || [];
}

/* =========================================================
   STATISTICS
   ========================================================= */

function renderStatistics() {
    const today = new Date();

    const total = state.appointments.length;

    const scheduledToday = state.appointments.filter((appointment) => {
        const date = new Date(appointment.appointment_datetime);

        return (
            sameDay(date, today) &&
            ['scheduled', 'rescheduled'].includes(appointment.status)
        );
    }).length;

    $('total-count').textContent = total;
    $('today-count').textContent = `${scheduledToday} scheduled today`;
}

/* =========================================================
   FILTER APPOINTMENTS
   ========================================================= */

function getFilteredAppointments() {
    const now = new Date();
    const current = state.currentDate;

    return state.appointments.filter((appointment) => {
        const date = new Date(appointment.appointment_datetime);

        // Colour-coded status filter
        if (
            state.statusFilter !== 'all' &&
            appointment.status !== state.statusFilter
        ) {
            return false;
        }

        // Date range filter
        let inRange = false;

        if (state.dateRange === 'today') {
            inRange = sameDay(date, current);
        } else if (state.dateRange === 'week') {
            const start = new Date(
                current.getFullYear(),
                current.getMonth(),
                current.getDate()
            );

            start.setDate(start.getDate() - start.getDay());

            const end = new Date(start);
            end.setDate(end.getDate() + 7);

            inRange = date >= start && date < end;
        } else if (state.dateRange === 'month') {
            inRange =
                date.getFullYear() === current.getFullYear() &&
                date.getMonth() === current.getMonth();
        }

        if (!inRange) return false;

        // Upcoming / Past / All
        if (state.filter === 'all') {
            return true;
        }

        const active = ['scheduled', 'rescheduled'].includes(
            appointment.status
        );

        if (state.filter === 'upcoming') {
            return active && date >= now;
        }

        if (state.filter === 'past') {
            return !active || date < now;
        }

        return true;
    });
}

function updateFilterButtons() {
    document.querySelectorAll('[data-filter]').forEach((button) => {
        const active = button.dataset.filter === state.filter;

        button.classList.toggle('active', active);
        button.classList.toggle('text-accent', active);
        button.classList.toggle('text-muted', !active);
    });
}

/* =========================================================
   APPOINTMENT CARDS
   ========================================================= */

function createAppointmentCard(appointment) {
    const customer = getCustomer(appointment);
    const vehicle = getVehicle(appointment);
    const date = new Date(appointment.appointment_datetime);

    const day = formatDate(date, { day: '2-digit' });
    const month = formatDate(date, { month: 'short' });

    const time = formatDate(date, {
        hour: 'numeric',
        minute: '2-digit'
    });

    const vehicleName = getVehicleName(vehicle);

    const canCancel = ['scheduled', 'rescheduled'].includes(
        appointment.status
    );

    const canReschedule = [
        'scheduled',
        'rescheduled',
        'missed'
    ].includes(appointment.status);

    const reminderEnabled = appointment.reminder_enabled !== false;

    return `
        <div class="appointment-card"
            data-appointment-id="${appointment.appointment_id}">

            <div class="appointment-date">
                <span class="appointment-date-day">${day}</span>
                <span class="appointment-date-month">${month}</span>
            </div>

            <div class="appointment-info">
                <div class="flex flex-wrap items-center gap-3">
                    <h3 class="appointment-customer">
                        ${escapeHtml(
                            customer?.full_name || 'Unknown Customer'
                        )}
                    </h3>

                    ${getStatusBadge(appointment.status)}
                </div>

                <p class="appointment-service">
                    ${escapeHtml(appointment.service_requested)}
                </p>

                <div class="appointment-meta">
                    <span class="appointment-meta-item">
                        ${escapeHtml(time)}
                    </span>

                    <span class="appointment-meta-item">
                        ${escapeHtml(vehicleName)}
                    </span>
                </div>
            </div>

            <div class="appointment-actions">
                <button
                    type="button"
                    class="appointment-reminder-btn ${reminderEnabled ? 'enabled' : ''}"
                    data-action="reminder"
                    data-id="${appointment.appointment_id}"
                    title="${reminderEnabled ? 'Disable reminder' : 'Enable reminder'}"
                    aria-label="${reminderEnabled ? 'Disable reminder' : 'Enable reminder'}"
                    aria-pressed="${reminderEnabled}"
                    ${!canCancel ? 'disabled' : ''}
                >
                    <i data-lucide="${reminderEnabled ? 'bell-ring' : 'bell-off'}"></i>
                </button>

                <button
                    type="button"
                    class="btn btn-secondary text-xs"
                    data-action="reschedule"
                    data-id="${appointment.appointment_id}"
                    ${!canReschedule ? 'disabled' : ''}
                >
                    Reschedule
                </button>

                <button
                    type="button"
                    class="btn appointment-cancel-btn text-xs"
                    data-action="cancel"
                    data-id="${appointment.appointment_id}"
                    ${!canCancel ? 'disabled' : ''}
                >
                    Cancel
                </button>
            </div>
        </div>
    `;
}

/* =========================================================
   LIST VIEW
   ========================================================= */

function renderAppointmentList() {
    const container = $('appointment-list');
    const appointments = getFilteredAppointments();

    if (!appointments.length) {
        container.innerHTML = `
            <div class="appointment-empty">
                <h3 class="appointment-empty-title">
                    No appointments found
                </h3>

                <p class="appointment-empty-description">
                    There are no appointments matching
                    the selected filters.
                </p>
            </div>
        `;

        return;
    }

    container.innerHTML = appointments
        .map(createAppointmentCard)
        .join('');

    if (window.lucide) {
        window.lucide.createIcons();
    }

    container.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', async () => {
            const appointment = state.appointments.find(
                (item) => item.appointment_id === button.dataset.id
            );

            if (!appointment) return;

            const action = button.dataset.action;

            if (action === 'reschedule') {
                await openAppointmentForm(appointment);
            }

            if (action === 'cancel') {
                const confirmed = window.confirm(
                    'Are you sure you want to cancel this appointment?'
                );

                if (!confirmed) return;

                button.disabled = true;

                await updateAppointmentStatus(
                    appointment.appointment_id,
                    'cancelled'
                );
            }

            if (action === 'reminder') {
                button.disabled = true;
                await toggleAppointmentReminder(appointment);
            }
        });
    });
}

/* =========================================================
   CALENDAR VIEW
   ========================================================= */

function renderCalendar() {
    const container = $('appointment-calendar');
    const current = state.currentDate;

    let startDate;
    let numberOfDays;

    if (state.dateRange === 'today') {
        startDate = new Date(
            current.getFullYear(),
            current.getMonth(),
            current.getDate()
        );

        numberOfDays = 1;
    } else if (state.dateRange === 'week') {
        startDate = new Date(
            current.getFullYear(),
            current.getMonth(),
            current.getDate()
        );

        startDate.setDate(
            startDate.getDate() - startDate.getDay()
        );

        numberOfDays = 7;
    } else {
        startDate = new Date(
            current.getFullYear(),
            current.getMonth(),
            1
        );

        startDate.setDate(
            startDate.getDate() - startDate.getDay()
        );

        numberOfDays = 42;
    }

    const appointments = getFilteredAppointments();

    const weekdays = [
        'Sun', 'Mon', 'Tue', 'Wed',
        'Thu', 'Fri', 'Sat'
    ];

    let html = `
        <div class="appointment-calendar-grid">
    `;

    if (state.dateRange === 'today') {
        html += `
            <div class="appointment-calendar-heading"
                style="grid-column: 1 / -1">
                ${formatDate(current, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric'
                })}
            </div>
        `;
    } else {
        html += weekdays.map((day) => `
            <div class="appointment-calendar-heading">
                ${day}
            </div>
        `).join('');
    }

    for (let index = 0; index < numberOfDays; index++) {
        const day = new Date(startDate);
        day.setDate(startDate.getDate() + index);

        const dayAppointments = appointments.filter(
            (appointment) => sameDay(
                new Date(appointment.appointment_datetime),
                day
            )
        );

        const isToday = sameDay(day, new Date());

        const outsideMonth =
            state.dateRange === 'month' &&
            day.getMonth() !== current.getMonth();

        const dateKey = [
            day.getFullYear(),
            String(day.getMonth() + 1).padStart(2, '0'),
            String(day.getDate()).padStart(2, '0')
        ].join('-');

        html += `
            <button
                type="button"
                class="appointment-calendar-day
                    ${isToday ? 'today' : ''}
                    ${outsideMonth ? 'outside-month' : ''}"
                data-calendar-date="${dateKey}"
                ${state.dateRange === 'today'
                    ? 'style="grid-column: 1 / -1"'
                    : ''}
            >
                <span class="appointment-calendar-date">
                    ${day.getDate()}
                </span>

                ${dayAppointments.map((appointment) => `
                    <span class="appointment-calendar-event
                        ${escapeHtml(appointment.status)}">
                        ${escapeHtml(
                            getCustomer(appointment)?.full_name ||
                            'Appointment'
                        )}
                    </span>
                `).join('')}
            </button>
        `;
    }

    html += '</div>';

    container.innerHTML = html;

    container.querySelectorAll('[data-calendar-date]').forEach((button) => {
        button.addEventListener('click', () => {
            const [year, month, day] =
                button.dataset.calendarDate
                    .split('-')
                    .map(Number);

            state.currentDate = new Date(year, month - 1, day);
            state.dateRange = 'today';
            state.selectedDate = null;

            renderPage();
        });
    });
}

/* =========================================================
   PERIOD NAVIGATION
   ========================================================= */

function renderPeriod() {
    const date = state.currentDate;

    if (state.dateRange === 'today') {
        $('period').textContent = formatDate(date, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
    } else if (state.dateRange === 'week') {
        const start = new Date(date);

        start.setDate(date.getDate() - date.getDay());

        const end = new Date(start);
        end.setDate(start.getDate() + 6);

        $('period').textContent =
            `${formatDate(start, {
                month: 'short',
                day: 'numeric'
            })} - ${formatDate(end, {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            })}`;
    } else {
        $('period').textContent = formatDate(date, {
            month: 'long',
            year: 'numeric'
        });
    }
}

function changePeriod(direction) {
    const date = new Date(state.currentDate);

    if (state.dateRange === 'today') {
        date.setDate(date.getDate() + direction);
    } else if (state.dateRange === 'week') {
        date.setDate(date.getDate() + direction * 7);
    } else {
        date.setDate(1);
        date.setMonth(date.getMonth() + direction);
    }

    state.currentDate = date;
    state.selectedDate = null;

    renderPage();
}

/* =========================================================
   CLICKABLE COLOUR-CODED STATUS FILTERS
   ========================================================= */

function renderLegend() {
    const legend = $('legend');

    if (!legend) return;

    const statuses = [
        ['all', 'All'],
        ...Object.entries(STATUS_LABELS)
    ];

    legend.innerHTML = statuses.map(([status, label]) => {
        const selected = state.statusFilter === status;

        const dot = status === 'all'
            ? ''
            : `
                <span
                    class="appointment-status-dot"
                    style="background-color: ${STATUS_COLORS[status]}"
                ></span>
            `;

        return `
            <button
                type="button"
                class="appointment-legend-item appointment-legend-filter
                    ${selected ? 'active' : ''}"
                data-status-filter="${status}"
                aria-pressed="${selected}"
            >
                ${dot}
                ${escapeHtml(label)}
            </button>
        `;
    }).join('');

    legend.querySelectorAll('[data-status-filter]').forEach((button) => {
        button.addEventListener('click', () => {
            const selectedStatus = button.dataset.statusFilter;

            state.statusFilter =
                state.statusFilter === selectedStatus
                    ? 'all'
                    : selectedStatus;

            renderPage();
        });
    });
}

function installLegendStyles() {
    if (document.getElementById('appointment-legend-filter-styles')) {
        return;
    }

    const style = document.createElement('style');
    style.id = 'appointment-legend-filter-styles';

    style.textContent = `
        .appointment-legend-filter {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 7px 12px;
            border: 1px solid transparent;
            border-radius: 8px;
            background: transparent;
            color: var(--color-muted);
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: background .2s, border-color .2s, color .2s;
        }

        .appointment-legend-filter:hover {
            background: var(--color-raised);
            color: var(--color-ink);
        }

        .appointment-legend-filter.active {
            background: var(--color-raised);
            border-color: var(--color-accent);
            color: var(--color-ink);
        }

        .appointment-legend-filter .appointment-status-dot {
            width: 9px;
            height: 9px;
            border-radius: 50%;
            flex-shrink: 0;
        }
    `;

    document.head.appendChild(style);
}

/* =========================================================
   NEW / EDIT APPOINTMENT FORM
   ========================================================= */

async function openAppointmentForm(appointment = null) {
    try {
        await loadFormData();
    } catch (error) {
        showError(error.message);
        return;
    }

    const editing = Boolean(appointment);

    const title = editing
        ? 'Edit Appointment'
        : 'New Appointment';

    const customerOptions = state.customers.map((customer) => `
        <option
            value="${customer.customer_id}"
            ${appointment?.customer_id === customer.customer_id
                ? 'selected'
                : ''}
        >
            ${escapeHtml(customer.full_name)}
        </option>
    `).join('');

    const reminderOptions = [
        [15, '15 minutes before'],
        [30, '30 minutes before'],
        [60, '1 hour before'],
        [120, '2 hours before'],
        [1440, '1 day before']
    ].map(([value, label]) => `
        <option
            value="${value}"
            ${Number(appointment?.reminder_lead_minutes ?? 60) === value
                ? 'selected'
                : ''}
        >
            ${label}
        </option>
    `).join('');

    openModal(`
        <div class="appointment-modal-overlay">
            <div
                class="appointment-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="appointment-modal-title"
            >
                <div class="appointment-modal-header">
                    <h2
                        id="appointment-modal-title"
                        class="appointment-modal-title"
                    >
                        ${title}
                    </h2>

                    <button
                        type="button"
                        data-close-modal
                        class="btn btn-secondary"
                        aria-label="Close"
                    >
                        &times;
                    </button>
                </div>

                <form id="appointment-form">
                    <div class="appointment-modal-body">
                        <div class="appointment-form">

                            <div class="appointment-form-group full-width">
                                <label
                                    class="appointment-form-label"
                                    for="appointment-customer"
                                >
                                    Customer *
                                </label>

                                <select
                                    id="appointment-customer"
                                    name="customer_id"
                                    class="field"
                                    required
                                >
                                    <option value="">
                                        Select customer
                                    </option>

                                    ${customerOptions}
                                </select>
                            </div>

                            <div class="appointment-form-group full-width">
                                <label
                                    class="appointment-form-label"
                                    for="appointment-vehicle"
                                >
                                    Vehicle
                                </label>

                                <select
                                    id="appointment-vehicle"
                                    name="vehicle_id"
                                    class="field"
                                >
                                    <option value="">
                                        No vehicle selected
                                    </option>
                                </select>
                            </div>

                            <div class="appointment-form-group full-width">
                                <label
                                    class="appointment-form-label"
                                    for="appointment-contact"
                                >
                                    Contact Number *
                                </label>

                                <input
                                    id="appointment-contact"
                                    name="contact_number"
                                    type="tel"
                                    maxlength="20"
                                    class="field"
                                    required
                                    value="${escapeHtml(
                                        appointment?.contact_number || ''
                                    )}"
                                />
                            </div>

                            <div class="appointment-form-group full-width">
                                <label
                                    class="appointment-form-label"
                                    for="appointment-service"
                                >
                                    Service Requested *
                                </label>

                                <input
                                    id="appointment-service"
                                    name="service_requested"
                                    type="text"
                                    maxlength="255"
                                    class="field"
                                    required
                                    value="${escapeHtml(
                                        appointment?.service_requested || ''
                                    )}"
                                />
                            </div>

                            <div class="appointment-form-group full-width">
                                <label
                                    class="appointment-form-label"
                                    for="appointment-datetime"
                                >
                                    Appointment Date & Time *
                                </label>

                                <input
                                    id="appointment-datetime"
                                    name="appointment_datetime"
                                    type="datetime-local"
                                    class="field"
                                    required
                                    value="${editing
                                        ? getLocalDateTime(
                                            appointment.appointment_datetime
                                        )
                                        : ''}"
                                />
                            </div>

                            <div class="appointment-form-group full-width">
                                <label
                                    class="appointment-form-label"
                                    for="appointment-reminder"
                                >
                                    Reminder
                                </label>

                                <select
                                    id="appointment-reminder"
                                    name="reminder_lead_minutes"
                                    class="field"
                                >
                                    ${reminderOptions}
                                </select>
                            </div>

                        </div>
                    </div>

                    <div class="appointment-modal-footer">
                        <button
                            type="button"
                            data-close-modal
                            class="btn btn-secondary"
                        >
                            Cancel
                        </button>

                        <button
                            type="submit"
                            id="save-appointment"
                            class="btn btn-primary"
                        >
                            Save Appointment
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `);

    const form = $('appointment-form');
    const customerSelect = $('appointment-customer');
    const vehicleSelect = $('appointment-vehicle');
    const contactInput = $('appointment-contact');

    function updateVehicleOptions() {
        const customerId = customerSelect.value;

        const vehicles = state.vehicles.filter(
            (vehicle) => vehicle.customer_id === customerId
        );

        vehicleSelect.innerHTML = `
            <option value="">No vehicle selected</option>

            ${vehicles.map((vehicle) => `
                <option
                    value="${vehicle.vehicle_id}"
                    ${appointment?.vehicle_id === vehicle.vehicle_id
                        ? 'selected'
                        : ''}
                >
                    ${escapeHtml(getVehicleName(vehicle))}
                    ${vehicle.plate_number
                        ? ` - ${escapeHtml(vehicle.plate_number)}`
                        : ''}
                </option>
            `).join('')}
        `;
    }

    customerSelect.addEventListener('change', () => {
        updateVehicleOptions();

        const customer = state.customers.find(
            (item) => item.customer_id === customerSelect.value
        );

        contactInput.value = customer?.phone_number || '';
    });

    updateVehicleOptions();

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        await saveAppointment(form, appointment);
    });
}

/* =========================================================
   SAVE APPOINTMENT
   ========================================================= */

async function saveAppointment(form, existingAppointment = null) {
    const saveButton = $('save-appointment');
    const formData = new FormData(form);

    const appointmentDate = new Date(
        formData.get('appointment_datetime')
    );

    if (Number.isNaN(appointmentDate.getTime())) {
        showError('Please select a valid appointment date.');
        return;
    }

    const payload = {
        customer_id: formData.get('customer_id'),
        vehicle_id: formData.get('vehicle_id') || null,
        contact_number: String(
            formData.get('contact_number')
        ).trim(),
        service_requested: String(
            formData.get('service_requested')
        ).trim(),
        appointment_datetime: appointmentDate.toISOString(),
        reminder_lead_minutes: Number(
            formData.get('reminder_lead_minutes')
        )
    };

    if (
        !payload.customer_id ||
        !payload.contact_number ||
        !payload.service_requested
    ) {
        showError('Please complete all required fields.');
        return;
    }

    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';

    try {
        let result;

        if (existingAppointment) {
            if (
                new Date(existingAppointment.appointment_datetime)
                    .getTime() !== appointmentDate.getTime() &&
                ['scheduled', 'rescheduled', 'missed'].includes(
                    existingAppointment.status
                )
            ) {
                payload.status = 'rescheduled';
            }

            result = await supabase
                .from('appointments')
                .update(payload)
                .eq(
                    'appointment_id',
                    existingAppointment.appointment_id
                );
        } else {
            payload.created_by = state.userId;
            payload.status = 'scheduled';

            result = await supabase
                .from('appointments')
                .insert(payload);
        }

        if (result.error) {
            throw result.error;
        }

        closeModal();

        showToast(
            existingAppointment
                ? 'Appointment updated'
                : 'Appointment created'
        );

        await loadAppointments();
    } catch (error) {
        console.error('Save appointment error:', error);
        showError(error.message);
    } finally {
        if (saveButton.isConnected) {
            saveButton.disabled = false;
            saveButton.textContent = 'Save Appointment';
        }
    }
}

/* =========================================================
   APPOINTMENT DETAILS
   ========================================================= */

function openAppointmentDetails(appointment) {
    const customer = getCustomer(appointment);
    const vehicle = getVehicle(appointment);

    const formattedDate = formatDate(
        appointment.appointment_datetime,
        {
            dateStyle: 'full',
            timeStyle: 'short'
        }
    );

    const statusOptions = Object.entries(STATUS_LABELS)
        .map(([value, label]) => `
            <option
                value="${value}"
                ${appointment.status === value ? 'selected' : ''}
            >
                ${label}
            </option>
        `).join('');

    openModal(`
        <div class="appointment-modal-overlay">
            <div
                class="appointment-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="appointment-details-title"
            >
                <div class="appointment-modal-header">
                    <h2
                        id="appointment-details-title"
                        class="appointment-modal-title"
                    >
                        Appointment Details
                    </h2>

                    <button
                        type="button"
                        data-close-modal
                        class="btn btn-secondary"
                    >
                        &times;
                    </button>
                </div>

                <div class="appointment-modal-body space-y-6">
                    <div>
                        <div class="flex flex-wrap items-center gap-3">
                            <h3 class="font-display text-xl font-bold">
                                ${escapeHtml(
                                    customer?.full_name ||
                                    'Unknown Customer'
                                )}
                            </h3>

                            ${getStatusBadge(appointment.status)}
                        </div>

                        <p class="mt-2 text-sm text-accent">
                            ${escapeHtml(appointment.service_requested)}
                        </p>
                    </div>

                    <div class="grid gap-5 sm:grid-cols-2">
                        <div>
                            <p class="text-xs text-muted uppercase">
                                Date & Time
                            </p>
                            <p class="mt-2 text-sm font-semibold">
                                ${escapeHtml(formattedDate)}
                            </p>
                        </div>

                        <div>
                            <p class="text-xs text-muted uppercase">
                                Contact Number
                            </p>
                            <p class="mt-2 text-sm font-semibold">
                                ${escapeHtml(appointment.contact_number)}
                            </p>
                        </div>

                        <div>
                            <p class="text-xs text-muted uppercase">
                                Vehicle
                            </p>
                            <p class="mt-2 text-sm font-semibold">
                                ${escapeHtml(getVehicleName(vehicle))}
                            </p>
                        </div>

                        <div>
                            <p class="text-xs text-muted uppercase">
                                Reminder
                            </p>
                            <p class="mt-2 text-sm font-semibold">
                                ${Number(
                                    appointment.reminder_lead_minutes ?? 60
                                )} minutes before
                            </p>
                        </div>
                    </div>

                    <div>
                        <label
                            for="appointment-detail-status"
                            class="block mb-2 text-xs text-muted uppercase"
                        >
                            Appointment Status
                        </label>

                        <select
                            id="appointment-detail-status"
                            class="field"
                        >
                            ${statusOptions}
                        </select>
                    </div>
                </div>

                <div class="appointment-modal-footer">
                    <button
                        type="button"
                        id="cancel-appointment"
                        class="btn btn-danger"
                    >
                        Cancel Appointment
                    </button>

                    <button
                        type="button"
                        id="update-appointment-status"
                        class="btn btn-secondary"
                    >
                        Update Status
                    </button>

                    <button
                        type="button"
                        id="edit-appointment"
                        class="btn btn-primary"
                    >
                        Edit / Reschedule
                    </button>
                </div>
            </div>
        </div>
    `);

    $('edit-appointment').addEventListener('click', () => {
        openAppointmentForm(appointment);
    });

    $('update-appointment-status').addEventListener(
        'click',
        async () => {
            const status = $('appointment-detail-status').value;

            await updateAppointmentStatus(
                appointment.appointment_id,
                status
            );
        }
    );

    $('cancel-appointment').addEventListener(
        'click',
        async () => {
            const confirmed = window.confirm(
                'Are you sure you want to cancel this appointment?'
            );

            if (!confirmed) return;

            await updateAppointmentStatus(
                appointment.appointment_id,
                'cancelled'
            );
        }
    );
}

/* =========================================================
   UPDATE APPOINTMENT STATUS
   ========================================================= */

async function updateAppointmentStatus(appointmentId, status) {
    if (!Object.hasOwn(STATUS_LABELS, status)) {
        showError('Invalid appointment status.');
        return;
    }

    const { error } = await supabase
        .from('appointments')
        .update({ status })
        .eq('appointment_id', appointmentId);

    if (error) {
        showError(error.message);
        renderPage();
        return;
    }

    closeModal();
    showToast('Appointment status updated');

    await loadAppointments();
}

/* =========================================================
   REMINDER TOGGLE
   ========================================================= */

async function toggleAppointmentReminder(appointment) {
    const newValue = appointment.reminder_enabled === false;

    const { error } = await supabase
        .from('appointments')
        .update({
            reminder_enabled: newValue
        })
        .eq('appointment_id', appointment.appointment_id);

    if (error) {
        showError(error.message);
        renderPage();
        return;
    }

    appointment.reminder_enabled = newValue;

    showToast(
        newValue
            ? 'Appointment reminder enabled'
            : 'Appointment reminder disabled'
    );

    renderPage();
}

/* =========================================================
   VIEW CONTROLS
   ========================================================= */

function updateViewButtons() {
    $('calendar-view').classList.toggle(
        'active',
        state.view === 'calendar'
    );

    $('list-view').classList.toggle(
        'active',
        state.view === 'list'
    );

    $('today').classList.toggle(
        'active',
        state.dateRange === 'today'
    );

    $('week').classList.toggle(
        'active',
        state.dateRange === 'week'
    );

    $('month').classList.toggle(
        'active',
        state.dateRange === 'month'
    );

    $('appointment-list').classList.toggle(
        'hidden',
        state.view !== 'list'
    );

    $('appointment-calendar').classList.toggle(
        'hidden',
        state.view !== 'calendar'
    );
}

/* =========================================================
   RENDER PAGE
   ========================================================= */

function renderPage() {
    renderStatistics();
    renderPeriod();
    renderLegend();
    updateFilterButtons();
    updateViewButtons();

    if (state.view === 'calendar') {
        renderCalendar();
    } else {
        renderAppointmentList();
    }
}

/* =========================================================
   EVENT LISTENERS
   ========================================================= */

function setupEventListeners() {
    $('new-appointment').addEventListener('click', () => {
        openAppointmentForm();
    });

    // Calendar / List
    $('calendar-view').addEventListener('click', () => {
        state.view = 'calendar';
        renderPage();
    });

    $('list-view').addEventListener('click', () => {
        state.view = 'list';
        renderPage();
    });

    // Today / Week / Month
    $('today').addEventListener('click', () => {
        state.currentDate = new Date();
        state.dateRange = 'today';
        state.selectedDate = null;
        renderPage();
    });

    $('week').addEventListener('click', () => {
        state.dateRange = 'week';
        state.selectedDate = null;
        renderPage();
    });

    $('month').addEventListener('click', () => {
        state.dateRange = 'month';
        state.selectedDate = null;
        renderPage();
    });

    // Previous / Next
    $('previous').addEventListener('click', () => {
        changePeriod(-1);
    });

    $('next').addEventListener('click', () => {
        changePeriod(1);
    });

    // Upcoming / Past / All
    document.querySelectorAll('[data-filter]').forEach((button) => {
        button.addEventListener('click', () => {
            state.filter = button.dataset.filter;
            renderPage();
        });
    });

    // Close modal with Escape
    document.addEventListener('keydown', (event) => {
        if (
            event.key === 'Escape' &&
            $('appointment-dialog-root').children.length
        ) {
            closeModal();
        }
    });
}

/* =========================================================
   INITIALIZE
   ========================================================= */

async function init() {
    try {
        const session = await initPage({
            active: 'appointments'
        });

        if (!session) return;

        state.userId = session.user.id;

        installLegendStyles();
        setupEventListeners();

        await loadAppointments();

        // Automatically open your form from the dashboard
        const params = new URLSearchParams(window.location.search);

        if (params.get('new') === 'true') {
            await openAppointmentForm();
        }
    } catch (error) {
        console.error('Appointments initialization failed:', error);

        showError(
            error.message || 'Unable to initialize appointments page.'
        );
    }
}

init();