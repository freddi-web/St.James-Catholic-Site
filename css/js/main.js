const API_ROOT = "/api";
const READINGS_CACHE_KEY = "stJamesDailyReadings";

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
}

async function requestApi(path, options = {}) {
    const response = await fetch(`${API_ROOT}${path}`, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
    return body;
}

function formatCurrency(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? `KES ${amount.toLocaleString("en-KE")}` : "KES 0";
}

function renderCards(host, items, render) {
    if (!host) return;
    host.innerHTML = items.length ? items.map(render).join("") : "";
}

function renderPublicData(data) {
    const { content, settings } = data;
    const isShown = settings.show_schedules === true || settings.show_schedules === "true";
    const schedules = (content.schedules || []).filter(item => item.visible !== false);
    const scheduleHost = document.getElementById("publicSchedules");
    scheduleHost.hidden = !isShown;
    document.getElementById("publicScheduleMessage").textContent =
        !isShown ? "Service times are temporarily unavailable." : schedules.length ? "" : "Service times will be published here once confirmed by the parish.";
    renderCards(scheduleHost, isShown ? schedules : [], item => `
        <article class="schedule-card">
            <span class="schedule-day">${escapeHtml(item.day)}</span>
            <h3>${escapeHtml(item.type)}</h3>
            <p>${escapeHtml(item.time)}</p>
        </article>`);

    const announcement = String(settings.announcement || "").trim();
    const bar = document.getElementById("announcementBar");
    if (announcement) {
        bar.hidden = false;
        document.getElementById("announcementText").textContent = announcement;
        document.getElementById("announcementPreview").textContent = announcement;
    }

    const ministryHost = document.getElementById("publicMinistries");
    renderCards(ministryHost, content.ministries || [], item => `
        <article class="ministry-card dynamic-card">
            <span class="card-icon" aria-hidden="true">✣</span>
            <h3>${escapeHtml(item.name)}</h3>
            <p>${escapeHtml(item.description)}</p>
            ${item.moderator ? `<p class="reading-reference">Contact: ${escapeHtml(item.moderator)}</p>` : ""}
        </article>`);

    const jumuiyaHost = document.getElementById("publicJumuiyas");
    renderCards(jumuiyaHost, content.jumuiyas || [], item => `
        <article class="ministry-card dynamic-card">
            <span class="card-icon" aria-hidden="true">◎</span>
            <h3>${escapeHtml(item.name)}</h3>
            <p><strong>Patron:</strong> ${escapeHtml(item.patron || "To be announced")}</p>
            <p><strong>Meetings:</strong> ${escapeHtml(item.schedule || "To be announced")}</p>
            <p><strong>Venue:</strong> ${escapeHtml(item.venue || "To be announced")}</p>
            ${item.leader ? `<p><strong>Leader:</strong> ${escapeHtml(item.leader)}</p>` : ""}
            ${item.contact ? `<p><strong>Contact:</strong> ${escapeHtml(item.contact)}</p>` : ""}
        </article>`);

    const projects = content.projects || [];
    document.getElementById("publicProjectsMessage").textContent = projects.length ? "" : "Parish development projects will be shared here.";
    renderCards(document.getElementById("publicProjects"), projects, item => {
        const goal = Number(item.goal) || 0;
        const raised = Number(item.raised) || 0;
        const progress = goal ? Math.min(100, Math.round(raised / goal * 100)) : 0;
        return `<article class="ministry-card dynamic-card">
            ${item.image ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy">` : '<span class="card-icon" aria-hidden="true">◇</span>'}
            <h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p>
            <p><strong>${escapeHtml(item.status || "Ongoing")}</strong></p>
            ${goal ? `<p>${formatCurrency(raised)} raised of ${formatCurrency(goal)}</p><progress value="${progress}" max="100" aria-label="${progress}% funded"></progress>` : ""}
        </article>`;
    });
    const payment = settings.payment || {};
    const mpesa = [
        payment.paybill ? `<p><strong>Paybill:</strong> ${escapeHtml(payment.paybill)}</p>` : "",
        payment.till ? `<p><strong>Till:</strong> ${escapeHtml(payment.till)}</p>` : "",
        payment.account_name ? `<p><strong>Account name:</strong> ${escapeHtml(payment.account_name)}</p>` : ""
    ].filter(Boolean);
    const bank = [
        payment.bank_name ? `<p><strong>Bank:</strong> ${escapeHtml(payment.bank_name)}</p>` : "",
        payment.account_name_bank ? `<p><strong>Account name:</strong> ${escapeHtml(payment.account_name_bank)}</p>` : "",
        payment.account_number ? `<p><strong>Account number:</strong> ${escapeHtml(payment.account_number)}</p>` : "",
        payment.branch ? `<p><strong>Branch:</strong> ${escapeHtml(payment.branch)}</p>` : ""
    ].filter(Boolean);
    document.getElementById("mpesaDetails").innerHTML = mpesa.join("") || "<p>Payment instructions will be shared by the parish.</p>";
    document.getElementById("bankDetails").innerHTML = bank.join("") || "<p>Bank transfer instructions will be shared by the parish.</p>";

    const events = content.events || [];
    document.getElementById("publicEventsMessage").textContent = events.length ? "" : "Upcoming parish events will be published here.";
    renderCards(document.getElementById("publicEvents"), events, item => `
        <article class="ministry-card dynamic-card">
            <span class="card-icon" aria-hidden="true">▦</span><h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.date || "")}${item.location ? ` · ${escapeHtml(item.location)}` : ""}</p>
            <p>${escapeHtml(item.description)}</p>
        </article>`);

    renderMap(settings.map_embed, settings.address);
    loadDailyReadings(settings.manual_readings || "");
}

function getMapEmbed(value) {
    const input = String(value || "").trim();
    if (!input) return "";
    let candidate = input;
    if (input.toLowerCase().includes("<iframe")) {
        const document = new DOMParser().parseFromString(input, "text/html");
        candidate = document.querySelector("iframe")?.getAttribute("src") || "";
    }
    try {
        const url = new URL(candidate);
        const host = url.hostname.toLowerCase();
        if (host === "maps.google.com" || host.endsWith(".google.com") && url.pathname.startsWith("/maps")) {
            if (url.pathname.includes("/embed")) return url.href;
            return `https://www.google.com/maps?q=${encodeURIComponent(url.href)}&output=embed`;
        }
        if (host === "maps.app.goo.gl" || host === "goo.gl") {
            return `https://www.google.com/maps?q=${encodeURIComponent(url.href)}&output=embed`;
        }
    } catch (error) {
        console.warn("The saved map location is not a valid Google Maps link.", error);
    }
    return "";
}

function renderMap(mapValue, address) {
    const host = document.getElementById("contactMap");
    const fallback = address || "Katheka Kai, Kenya";
    const embed = getMapEmbed(mapValue);
    if (embed) {
        host.innerHTML = `<iframe title="Map showing St. James Catholic Church" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${escapeHtml(embed)}"></iframe>`;
    } else {
        host.innerHTML = `<p class="empty-note">${escapeHtml(fallback)}</p>`;
    }
}

function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function manualReadings(value) {
    const readings = [];
    const aliases = [
        ["First Reading", /first\s*reading/i],
        ["Responsorial Psalm", /responsorial\s*psalm|^psalm/i],
        ["Second Reading", /second\s*reading/i],
        ["Gospel", /gospel/i]
    ];
    for (const line of String(value).split(/\r?\n/)) {
        const match = aliases.find(([, pattern]) => pattern.test(line));
        if (match) readings.push({ title: match[0], text: line.replace(/^[^:]+:\s*/, "").trim() });
    }
    return readings;
}

function excerptReadings(html) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const headings = [...parsed.querySelectorAll("h1,h2,h3,h4,strong")];
    const sections = [
        ["First Reading", /first reading/i],
        ["Responsorial Psalm", /responsorial psalm/i],
        ["Second Reading", /second reading/i],
        ["Gospel", /gospel/i]
    ];
    return sections.map(([title, pattern]) => {
        const heading = headings.find(item => pattern.test(item.textContent || ""));
        if (!heading) return null;
        let node = heading.parentElement;
        let text = "";
        for (let steps = 0; node && steps < 5; steps++, node = node.parentElement) {
            text = node.innerText || node.textContent || "";
            if (text.length > 80) break;
        }
        const label = heading.textContent.trim();
        const contents = text.replace(label, "").replace(/\s+/g, " ").trim();
        return { title, text: contents.slice(0, 900) };
    }).filter(item => item && item.text);
}

function renderReadings(readings, fallback = false) {
    const host = document.getElementById("dailyReadings");
    if (!readings.length) {
        host.innerHTML = `<article class="reading-card"><h3>Read today’s readings</h3><p>Online readings could not be loaded right now. Please try again later.</p><a class="text-link" href="https://bible.usccb.org/readings/" target="_blank" rel="noopener noreferrer">Open the daily readings →</a></article>`;
        return;
    }
    host.innerHTML = readings.map(item => `<article class="reading-card"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.text)}</p>${item.reference ? `<p class="reading-reference">${escapeHtml(item.reference)}</p>` : ""}</article>`).join("");
    if (fallback) {
        host.insertAdjacentHTML("beforeend", `<p class="reading-credit">Showing the parish’s manual reading notes.</p>`);
    }
}

async function loadDailyReadings(override) {
    const today = new Date();
    document.getElementById("readingDate").textContent = today.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const overrideItems = manualReadings(override);
    if (overrideItems.length) {
        renderReadings(overrideItems, true);
        return;
    }
    const key = dateKey(today);
    try {
        const cached = JSON.parse(localStorage.getItem(READINGS_CACHE_KEY) || "null");
        if (cached?.date === key && Array.isArray(cached.readings) && cached.readings.length) {
            renderReadings(cached.readings);
            return;
        }
    } catch (error) {
        console.warn("Could not read the cached readings.", error);
    }
    const monthDayYear = `${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}${String(today.getFullYear()).slice(-2)}`;
    const source = `https://bible.usccb.org/bible/readings/${monthDayYear}.cfm`;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 9000);
    try {
        const response = await fetch(source, { signal: controller.signal, mode: "cors" });
        if (!response.ok) throw new Error(`Readings source returned ${response.status}.`);
        const readings = excerptReadings(await response.text());
        if (!readings.length) throw new Error("The daily readings could not be parsed.");
        localStorage.setItem(READINGS_CACHE_KEY, JSON.stringify({ date: key, readings }));
        renderReadings(readings);
    } catch (error) {
        console.warn("Daily readings could not be fetched.", error);
        renderReadings([]);
    } finally {
        window.clearTimeout(timeout);
    }
}

function setupAccessibility() {
    const panel = document.getElementById("accessibilityPanel");
    const toggle = document.getElementById("accessibilityToggle");
    if (!panel || !toggle) return;
    const fields = {
        size: document.getElementById("textSize"),
        highContrast: document.getElementById("highContrast"),
        reduceMotion: document.getElementById("reduceMotion"),
        underlineLinks: document.getElementById("underlineLinks"),
        readableFont: document.getElementById("readableFont")
    };
    const defaults = { size: 100, highContrast: false, reduceMotion: false, underlineLinks: false, readableFont: false };
    const key = "stJamesAccessibility";
    let preferences = { ...defaults };
    try { preferences = { ...defaults, ...JSON.parse(localStorage.getItem(key) || "{}") }; }
    catch (error) { console.warn("Accessibility preferences could not be loaded.", error); }
    const apply = () => {
        document.documentElement.style.fontSize = `${preferences.size}%`;
        document.body.classList.toggle("high-contrast", preferences.highContrast);
        document.body.classList.toggle("reduce-motion", preferences.reduceMotion);
        document.body.classList.toggle("underline-links", preferences.underlineLinks);
        document.body.classList.toggle("readable-font", preferences.readableFont);
        fields.size.value = preferences.size;
        document.getElementById("textSizeValue").textContent = `${preferences.size}%`;
        for (const name of ["highContrast", "reduceMotion", "underlineLinks", "readableFont"]) fields[name].checked = preferences[name];
    };
    const save = () => {
        localStorage.setItem(key, JSON.stringify(preferences));
        apply();
    };
    fields.size.addEventListener("input", () => { preferences.size = Number(fields.size.value); save(); });
    for (const name of ["highContrast", "reduceMotion", "underlineLinks", "readableFont"]) {
        fields[name].addEventListener("change", () => { preferences[name] = fields[name].checked; save(); });
    }
    toggle.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
        toggle.setAttribute("aria-expanded", String(!panel.hidden));
    });
    document.getElementById("resetAccessibility").addEventListener("click", () => {
        preferences = { ...defaults };
        save();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !panel.hidden) {
            panel.hidden = true;
            toggle.setAttribute("aria-expanded", "false");
            toggle.focus();
        }
    });
    apply();
}

async function setupForms() {
    const giving = document.getElementById("givingForm");
    giving?.addEventListener("submit", async event => {
        event.preventDefault();
        const status = document.getElementById("givingMessage");
        try {
            await requestApi("/donations", {
                method: "POST",
                body: JSON.stringify({
                    amount: document.getElementById("givingAmount").value,
                    project: document.getElementById("givingProject").value.trim(),
                    reference: document.getElementById("givingReference").value.trim()
                })
            });
            giving.reset();
            status.textContent = "Your contribution record has been saved to your private giving history.";
            status.className = "form-message";
        } catch (error) {
            status.textContent = error.message.includes("Sign in is required") ? "Please sign in before recording a contribution." : error.message;
            status.className = "form-message error";
            if (error.message.includes("Sign in is required")) window.setTimeout(() => { window.location.href = "admin/login.html"; }, 1200);
        }
    });
    const sacramentForm = document.getElementById("sacramentForm");
    sacramentForm?.addEventListener("submit", async event => {
        event.preventDefault();
        const status = document.getElementById("sacramentMessage");
        try {
            await requestApi("/sacramental-requests", {
                method: "POST",
                body: JSON.stringify({
                    sacrament: document.getElementById("sacramentType").value,
                    applicant_name: document.getElementById("applicantName").value.trim(),
                    contact: document.getElementById("applicantContact").value.trim(),
                    details: document.getElementById("requestDetails").value.trim()
                })
            });
            sacramentForm.reset();
            status.textContent = "Your request has been submitted for parish office review.";
            status.className = "form-message";
        } catch (error) {
            status.textContent = error.message.includes("Sign in is required") ? "Please sign in to submit a sacramental or certificate request." : error.message;
            status.className = "form-message error";
            if (error.message.includes("Sign in is required")) window.setTimeout(() => { window.location.href = "admin/login.html"; }, 1200);
        }
    });
    const contactForm = document.getElementById("contactForm");
    contactForm?.addEventListener("submit", async event => {
        event.preventDefault();
        const status = document.getElementById("formMessage");
        try {
            await requestApi("/contact", {
                method: "POST",
                body: JSON.stringify({
                    name: document.getElementById("name").value.trim(),
                    email: document.getElementById("email").value.trim(),
                    message: document.getElementById("message").value.trim()
                })
            });
            contactForm.reset();
            status.textContent = "Thank you. Your message has been sent to the parish office.";
            status.className = "form-message";
        } catch (error) {
            status.textContent = error.message;
            status.className = "form-message error";
        }
    });
}

async function loadHomepage() {
    try {
        const data = await requestApi("/public");
        renderPublicData(data);
    } catch (error) {
        console.error("Could not load parish information.", error);
        const message = document.getElementById("publicScheduleMessage");
        if (message) message.textContent = "Parish information is temporarily unavailable. Please try again shortly.";
    }
}

const menuToggle = document.getElementById("menuToggle");
const navMenu = document.getElementById("navMenu");
menuToggle?.addEventListener("click", () => navMenu.classList.toggle("active"));
document.querySelectorAll(".nav-menu a").forEach(link => link.addEventListener("click", () => navMenu?.classList.remove("active")));
setupAccessibility();
setupForms();
loadHomepage();
