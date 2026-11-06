const API = "/api";
const SUPER_ADMIN_EMAIL = "mwendwafreddie@gmail.com";
const schemas = {
    schedules: [
        ["day", "Day", "text"], ["time", "Time", "text"],
        ["type", "Service", "text"], ["visible", "Show on homepage", "checkbox"]
    ],
    projects: [
        ["title", "Project title", "text"], ["description", "Description", "textarea"],
        ["goal", "Target goal (KES)", "number"], ["raised", "Amount raised (KES)", "number"],
        ["status", "Status", "text"], ["image", "Image URL (optional)", "url"]
    ],
    jumuiyas: [
        ["name", "Jumuiya name", "text"], ["patron", "Patron saint", "text"],
        ["schedule", "Meeting schedule", "text"], ["venue", "Venue", "text"],
        ["leader", "Leader name", "text"], ["contact", "Leader contact", "text"]
    ],
    ministries: [
        ["name", "Ministry name", "text"], ["description", "Description", "textarea"],
        ["moderator", "Moderator contact", "text"]
    ],
    events: [
        ["title", "Event title", "text"], ["date", "Date", "date"],
        ["location", "Location", "text"], ["description", "Description", "textarea"]
    ]
};
let activeUser = null;
let parishSettings = {};
let contentCache = {};

async function api(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options
    });
    const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
    return body;
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
}

function showAlert(message, type = "success") {
    const alert = document.getElementById("adminAlert");
    if (!alert) return;
    alert.textContent = message;
    alert.className = `admin-alert ${type}`;
    alert.hidden = false;
    window.clearTimeout(showAlert.timer);
    showAlert.timer = window.setTimeout(() => { alert.hidden = true; }, 5000);
}

async function loadLoginPage() {
    const form = document.getElementById("loginForm");
    if (!form) return;
    const message = document.getElementById("loginMessage");
    const toggle = document.getElementById("registerToggle");
    let registering = false;
    try {
        const result = await api("/auth/me");
        if (result.user) window.location.href = "dashboard.html";
    } catch (error) {
        console.error("Could not check the current sign-in:", error);
    }
    toggle.addEventListener("click", () => {
        registering = !registering;
        document.getElementById("nameGroup").hidden = !registering;
        document.getElementById("name").required = registering;
        document.getElementById("submitLabel").textContent = registering ? "Create account" : "Sign In";
        document.getElementById("password").autocomplete = registering ? "new-password" : "current-password";
        document.getElementById("password").placeholder = registering ? "At least 10 characters" : "Enter your password";
        toggle.textContent = registering ? "Already have an account? Sign in" : "Create a member account";
        message.textContent = "";
    });
    form.addEventListener("submit", async event => {
        event.preventDefault();
        const submit = form.querySelector("button[type=submit]");
        submit.disabled = true;
        message.textContent = "";
        try {
            const payload = {
                email: document.getElementById("email").value.trim(),
                password: document.getElementById("password").value
            };
            const result = await api(registering ? "/auth/register" : "/auth/login", {
                method: "POST",
                body: JSON.stringify(registering ? { ...payload, name: document.getElementById("name").value.trim() } : payload)
            });
            if (result.user) window.location.href = "dashboard.html";
        } catch (error) {
            message.textContent = error.message;
            message.className = "form-message error";
        } finally {
            submit.disabled = false;
        }
    });
}

function isAdmin() {
    return activeUser && (activeUser.role === "administrator" || activeUser.role === "super_admin" || activeUser.email.toLowerCase() === SUPER_ADMIN_EMAIL);
}

function setPermissions() {
    document.querySelectorAll("[data-super-only]").forEach(element => {
        element.hidden = activeUser.email.toLowerCase() !== SUPER_ADMIN_EMAIL;
    });
    if (!isAdmin() && activeUser.role !== "moderator") {
        document.querySelectorAll(".admin-nav-link[data-section]").forEach(link => {
            if (!["overview", "requests", "giving"].includes(link.dataset.section)) link.hidden = true;
        });
        document.getElementById("moderatorForm").hidden = false;
    }
    if (activeUser.role === "moderator") {
        document.getElementById("moderatorForm").hidden = true;
        document.getElementById("accessDescription").textContent = "Your approved scope is the only community area you can manage.";
    }
    document.getElementById("userName").textContent = activeUser.name;
    document.getElementById("userRole").textContent = activeUser.role.replace("_", " ");
    document.getElementById("userAvatar").textContent = activeUser.name.slice(0, 1).toUpperCase();
    const scope = activeUser.ministry ? `Ministry · ${activeUser.ministry}` : activeUser.jumuiya ? `Jumuiya · ${activeUser.jumuiya}` : "Parish-wide";
    document.getElementById("scopeSummary").textContent = `${activeUser.role.replace("_", " ")} access · ${scope}`;
}

function renderManager(collection, items) {
    const host = document.getElementById(`manager-${collection}`);
    if (!host) return;
    const fields = schemas[collection];
    const formFields = fields.map(([key, label, type]) => {
        if (type === "checkbox") return `<label class="checkbox-row"><input type="checkbox" name="${key}"> ${label}</label>`;
        if (type === "textarea") return `<div class="form-group full-width"><label for="${collection}-${key}">${label}</label><textarea id="${collection}-${key}" name="${key}" rows="3" ${key === fields[0][0] ? "required" : ""}></textarea></div>`;
        return `<div class="form-group"><label for="${collection}-${key}">${label}</label><input id="${collection}-${key}" name="${key}" type="${type}" ${key === fields[0][0] ? "required" : ""} ${type === "number" ? 'min="0" step="0.01"' : ""}></div>`;
    }).join("");
    const cards = items.length ? items.map(item => {
        const heading = item.title || item.name || item.type || "Service";
        const description = item.description || [item.day, item.time, item.schedule, item.venue, item.status].filter(Boolean).join(" · ");
        const edit = isAdmin() || activeUser.role === "moderator";
        return `<article class="manage-card"><div><h3>${escapeHtml(heading)}</h3><p>${escapeHtml(description)}</p></div><div class="manage-actions">${edit ? `<button type="button" class="secondary-btn" data-edit="${item.id}" data-collection="${collection}">Edit</button><button type="button" class="danger-btn" data-delete="${item.id}" data-collection="${collection}">Delete</button>` : ""}</div></article>`;
    }).join("") : `<p class="empty-note">No entries yet.</p>`;
    const mayEdit = isAdmin() || activeUser.role === "moderator";
    host.innerHTML = `${mayEdit ? `<form class="admin-form content-form" data-collection="${collection}"><input type="hidden" name="id"><div class="form-grid">${formFields}</div><div class="form-actions"><button class="admin-btn" type="submit">Save ${collection.slice(0, -1)}</button><button type="reset" class="secondary-btn">Clear</button></div></form>` : ""}<div class="manage-list">${cards}</div>`;
    const form = host.querySelector(".content-form");
    if (form) form.addEventListener("submit", async event => {
        event.preventDefault();
        const data = {};
        fields.forEach(([key, , type]) => {
            const input = form.elements.namedItem(key);
            data[key] = type === "checkbox" ? input.checked : type === "number" ? (input.value ? Number(input.value) : 0) : input.value.trim();
        });
        const id = form.elements.namedItem("id").value;
        try {
            await api(`/content/${collection}${id ? `/${id}` : ""}`, {
                method: id ? "PUT" : "POST", body: JSON.stringify(data)
            });
            showAlert("Parish information saved.");
            await loadCollection(collection);
        } catch (error) { showAlert(error.message, "error"); }
    });
    host.querySelectorAll("[data-edit]").forEach(button => button.addEventListener("click", () => {
        const entry = items.find(item => item.id === Number(button.dataset.edit));
        if (!entry || !form) return;
        form.elements.namedItem("id").value = entry.id;
        fields.forEach(([key, , type]) => {
            const input = form.elements.namedItem(key);
            if (type === "checkbox") input.checked = Boolean(entry[key]);
            else input.value = entry[key] ?? "";
        });
        form.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
    host.querySelectorAll("[data-delete]").forEach(button => button.addEventListener("click", async () => {
        if (!window.confirm("Remove this item from the parish website?")) return;
        try {
            await api(`/content/${collection}/${button.dataset.delete}`, { method: "DELETE" });
            showAlert("Item removed.");
            await loadCollection(collection);
        } catch (error) { showAlert(error.message, "error"); }
    }));
}

async function loadCollection(collection) {
    const result = await api(`/content/${collection}`);
    contentCache[collection] = result.items;
    renderManager(collection, result.items);
    const count = document.getElementById(`count${collection[0].toUpperCase()}${collection.slice(1)}`);
    if (count) count.textContent = result.items.length;
}

function renderRows(host, rows, columns, actions = "") {
    if (!rows.length) {
        host.innerHTML = `<p class="empty-note">Nothing to show yet.</p>`;
        return;
    }
    host.innerHTML = `<div class="table-wrap"><table class="admin-table"><thead><tr>${columns.map(([, title]) => `<th>${escapeHtml(title)}</th>`).join("")}<th>Actions</th></tr></thead><tbody>${rows.map(row => `<tr>${columns.map(([key]) => `<td>${escapeHtml(row[key] ?? "")}</td>`).join("")}<td>${actions(row)}</td></tr>`).join("")}</tbody></table></div>`;
}

async function loadModeratorRequests() {
    const result = await api("/moderator-requests");
    const host = document.getElementById("moderatorRequests");
    if (!isAdmin()) {
        host.innerHTML = `<p class="empty-note">Requests you submit will appear in the overview.</p>`;
        document.getElementById("countRequests").textContent = "—";
        document.getElementById("myRequests").innerHTML = result.items.map(item => `<p class="request-status">${escapeHtml(item.scope_type)} · ${escapeHtml(item.scope_name)} — <strong>${escapeHtml(item.status)}</strong></p>`).join("") || "";
        return;
    }
    document.getElementById("countRequests").textContent = result.items.filter(item => item.status === "pending").length;
    renderRows(host, result.items, [["name", "Applicant"], ["scope_type", "Area"], ["scope_name", "Requested access"], ["status", "Status"]], row =>
        `${row.status === "pending" ? `<button class="small-btn" data-review="${row.id}" data-status="approved">Approve</button><button class="small-btn secondary-btn" data-review="${row.id}" data-status="rejected">Reject</button>` : ""} <button class="small-btn danger-btn" data-request-delete="${row.id}">Delete</button>`);
    host.querySelectorAll("[data-review]").forEach(button => button.addEventListener("click", async () => {
        try {
            await api(`/moderator-requests/${button.dataset.review}`, { method: "PATCH", body: JSON.stringify({ status: button.dataset.status }) });
            showAlert(`Request ${button.dataset.status}.`);
            await loadModeratorRequests();
        } catch (error) { showAlert(error.message, "error"); }
    }));
    host.querySelectorAll("[data-request-delete]").forEach(button => button.addEventListener("click", async () => {
        if (!confirm("Delete this moderator request? Approved assignments will be revoked.")) return;
        try {
            await api(`/moderator-requests/${button.dataset.requestDelete}`, { method: "DELETE" });
            await loadModeratorRequests();
            showAlert("Moderator request removed.");
        } catch (error) { showAlert(error.message, "error"); }
    }));
}

async function loadSacramentalRequests() {
    const host = document.getElementById("sacramentalRequests");
    if (!isAdmin()) {
        host.innerHTML = `<p class="empty-note">Private request forms are available from the public parish website.</p>`;
        return;
    }
    const result = await api("/sacramental-requests");
    renderRows(host, result.items, [["sacrament", "Request"], ["applicant_name", "Applicant"], ["contact", "Contact"], ["status", "Status"]], row =>
        `${row.status === "pending" ? `<button class="small-btn" data-sacrament="${row.id}" data-status="approved">Approve</button><button class="small-btn secondary-btn" data-sacrament="${row.id}" data-status="rejected">Reject</button>` : ""}`);
    host.querySelectorAll("[data-sacrament]").forEach(button => button.addEventListener("click", async () => {
        try {
            await api(`/sacramental-requests/${button.dataset.sacrament}`, { method: "PATCH", body: JSON.stringify({ status: button.dataset.status }) });
            await loadSacramentalRequests();
            showAlert("Request updated.");
        } catch (error) { showAlert(error.message, "error"); }
    }));
}

async function loadDonations() {
    const result = await api("/donations");
    const host = document.getElementById("donationsList");
    renderRows(host, result.items, [["created_at", "Date"], ["name", "Member"], ["amount", "Amount (KES)"], ["project", "Project"], ["status", "Status"]], row =>
        isAdmin() && row.status !== "confirmed" ? `<button class="small-btn" data-confirm-donation="${row.id}">Confirm</button>` : "");
    host.querySelectorAll("[data-confirm-donation]").forEach(button => button.addEventListener("click", async () => {
        try {
            await api(`/donations/${button.dataset.confirmDonation}`, { method: "PATCH", body: "{}" });
            await loadDonations();
            showAlert("Contribution confirmed.");
        } catch (error) { showAlert(error.message, "error"); }
    }));
}

async function loadUsers() {
    if (!activeUser || activeUser.email.toLowerCase() !== SUPER_ADMIN_EMAIL) return;
    const result = await api("/users");
    const host = document.getElementById("usersList");
    renderRows(host, result.items, [["name", "Name"], ["email", "Email"], ["role", "Role"], ["enabled", "Access"]], row => {
        if (row.email.toLowerCase() === SUPER_ADMIN_EMAIL) return `<strong>Protected Super Admin</strong>`;
        return `<button class="small-btn" data-toggle-user="${row.id}" data-enabled="${row.enabled ? "false" : "true"}">${row.enabled ? "Disable" : "Enable"}</button> <button class="small-btn danger-btn" data-delete-user="${row.id}">Delete</button>`;
    });
    host.querySelectorAll("[data-toggle-user]").forEach(button => button.addEventListener("click", async () => {
        try {
            await api(`/users/${button.dataset.toggleUser}`, { method: "PATCH", body: JSON.stringify({ enabled: button.dataset.enabled === "true" }) });
            await loadUsers();
            showAlert("Account access updated.");
        } catch (error) { showAlert(error.message, "error"); }
    }));
    host.querySelectorAll("[data-delete-user]").forEach(button => button.addEventListener("click", async () => {
        if (!confirm("Permanently delete this account?")) return;
        try {
            await api(`/users/${button.dataset.deleteUser}`, { method: "DELETE" });
            await loadUsers();
            showAlert("Account deleted.");
        } catch (error) { showAlert(error.message, "error"); }
    }));
}

async function loadSettings() {
    parishSettings = await api("/settings");
    const payment = parishSettings.payment || {};
    const values = {
        announcementInput: parishSettings.announcement,
        paybillInput: payment.paybill,
        tillInput: payment.till,
        accountNameInput: payment.account_name,
        bankNameInput: payment.bank_name,
        bankAccountNameInput: payment.account_name_bank,
        bankAccountNumberInput: payment.account_number,
        bankBranchInput: payment.branch,
        addressInput: parishSettings.address,
        mapInput: parishSettings.map_embed,
        readingsInput: parishSettings.manual_readings,
        showSchedulesInput: parishSettings.show_schedules === true || parishSettings.show_schedules === "true"
    };
    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element.type === "checkbox") element.checked = Boolean(value);
        else element.value = value || "";
    });
    if (!isAdmin()) document.querySelector('[data-section="settings"]').hidden = true;
}

function setupDashboardNavigation() {
    const titles = {
        overview: "Parish overview", schedules: "Service times", projects: "Development projects",
        jumuiyas: "Jumuiya directory", ministries: "Ministries", events: "Parish events",
        requests: "Requests & applications", giving: "Giving history",
        members: "Members & access", settings: "Parish settings"
    };
    document.querySelectorAll(".admin-nav-link[data-section]").forEach(link => link.addEventListener("click", event => {
        event.preventDefault();
        const section = link.dataset.section;
        document.querySelectorAll(".admin-nav-link").forEach(nav => nav.classList.toggle("active", nav === link));
        document.querySelectorAll(".admin-panel").forEach(panel => panel.classList.toggle("active", panel.id === `panel-${section}`));
        document.getElementById("pageTitle").textContent = titles[section];
        document.getElementById("adminSidebar").classList.remove("open");
        history.replaceState(null, "", `#${section}`);
    }));
    const initial = location.hash.slice(1);
    const initialLink = document.querySelector(`.admin-nav-link[data-section="${CSS.escape(initial)}"]`);
    if (initialLink && !initialLink.hidden) initialLink.click();
    document.getElementById("sidebarToggle").addEventListener("click", () => document.getElementById("adminSidebar").classList.toggle("open"));
    document.getElementById("logoutButton").addEventListener("click", async () => {
        try { await api("/auth/logout", { method: "POST", body: "{}" }); }
        finally { window.location.href = "login.html"; }
    });
}

async function initializeDashboard() {
    try {
        const result = await api("/auth/me");
        if (!result.user) {
            window.location.href = "login.html";
            return;
        }
        activeUser = result.user;
        setPermissions();
        setupDashboardNavigation();
        const isPrivileged = isAdmin() || activeUser.role === "moderator";
        if (isPrivileged) {
            const collections = activeUser.role === "moderator"
                ? (activeUser.ministry ? ["ministries"] : ["jumuiyas"])
                : Object.keys(schemas);
            await Promise.all(collections.map(loadCollection));
        } else {
            const publicData = await api("/public");
            document.getElementById("countSchedules").textContent = publicData.content.schedules.length;
            document.getElementById("countProjects").textContent = publicData.content.projects.length;
            document.getElementById("countJumuiyas").textContent = publicData.content.jumuiyas.length;
        }
        await Promise.all([loadModeratorRequests(), loadSacramentalRequests(), loadDonations()]);
        if (isAdmin()) await loadSettings();
        if (activeUser.email.toLowerCase() === SUPER_ADMIN_EMAIL) await loadUsers();
    } catch (error) {
        if (error.message.includes("Sign in is required")) window.location.href = "login.html";
        else showAlert(error.message, "error");
    }
    const requestForm = document.getElementById("moderatorForm");
    requestForm.addEventListener("submit", async event => {
        event.preventDefault();
        try {
            await api("/moderator-requests", {
                method: "POST",
                body: JSON.stringify({
                    scope_type: document.getElementById("requestScopeType").value,
                    scope_name: document.getElementById("requestScopeName").value.trim(),
                    reason: document.getElementById("requestReason").value.trim()
                })
            });
            requestForm.reset();
            await loadModeratorRequests();
            showAlert("Your moderator request was submitted.");
        } catch (error) { showAlert(error.message, "error"); }
    });
    const settingsForm = document.getElementById("settingsForm");
    settingsForm.addEventListener("submit", async event => {
        event.preventDefault();
        const payment = {
            paybill: document.getElementById("paybillInput").value.trim(),
            till: document.getElementById("tillInput").value.trim(),
            account_name: document.getElementById("accountNameInput").value.trim(),
            bank_name: document.getElementById("bankNameInput").value.trim(),
            account_name_bank: document.getElementById("bankAccountNameInput").value.trim(),
            account_number: document.getElementById("bankAccountNumberInput").value.trim(),
            branch: document.getElementById("bankBranchInput").value.trim()
        };
        try {
            await api("/settings", {
                method: "PUT",
                body: JSON.stringify({
                    announcement: document.getElementById("announcementInput").value.trim(),
                    payment, address: document.getElementById("addressInput").value.trim(),
                    map_embed: document.getElementById("mapInput").value.trim(),
                    manual_readings: document.getElementById("readingsInput").value.trim(),
                    show_schedules: document.getElementById("showSchedulesInput").checked
                })
            });
            showAlert("Parish settings saved.");
        } catch (error) { showAlert(error.message, "error"); }
    });
}

loadLoginPage();
if (document.querySelector(".admin-layout")) initializeDashboard();
