const content = document.getElementById("content");

function getPageFromUrl() {
    const path = location.pathname.replace("/", "");
    return path || "home";
}

function setActive(page) {
    document.querySelectorAll("nav a[data-page]").forEach(a => {
        a.classList.toggle("active", a.dataset.page === page);
    });
}

async function checkAuthentication() {
    const token = localStorage.getItem("token");

    if (!token)
        return false;

    try {
        const res = await fetch("/api/me", {
            headers: {
                Authorization: "Bearer " + token
            }
        });

        return res.ok;

    }
    catch {
        return false;
    }
}

async function loadPage(name) {
    const protectedPages = ['account', 'fanfics'];
    const requiresAuth = protectedPages.includes(name);

    if (requiresAuth) {
        const isAuthenticated = await checkAuthentication();
        if (!isAuthenticated) {
            location.href = "/login";
            return;
        }
    }

    content.classList.remove("show");

    setTimeout(async () => {
        try {
            const res = await fetch(`/page/${name}`);
            if (!res.ok) throw new Error("404");

            content.innerHTML = await res.text();
            content.classList.add("show");

            setActive(name);
            initPageScripts(name);

        } catch {
            content.innerHTML = "<h2>Страница не найдена</h2>";
            content.classList.add("show");
        }
    }, 200);
}

document.querySelectorAll("a[data-page]").forEach(link => {
    link.addEventListener("click", async e => {
        e.preventDefault();
        const page = link.dataset.page;

        const protectedPages = ['account', 'fanfics'];
        if (protectedPages.includes(page)) {
            const isAuthenticated = await checkAuthentication();
            if (!isAuthenticated) {
                e.preventDefault();
                location.href = "/login";
                return;
            }
        }

        history.pushState({}, "", "/" + page);
        loadPage(page);
    });
});

window.addEventListener("popstate", () => {
    loadPage(getPageFromUrl());
});

loadPage(getPageFromUrl());

function initPageScripts(page) {
    if (["login", "register", "account"].includes(page)) {
        const event = new CustomEvent('pageLoaded', { detail: { page: page } });
        document.dispatchEvent(event);
    }

    if (page === "home") {
        updateHolidayCountdown();
        updateMayCountdown();
    }

    if (page === "status") {
        initStatusPage();
    }

    if (page === "fanfics") {
        if (typeof window.initFanficsPage === "function") {
            window.initFanficsPage();
        } else {
            console.error("fanfics.js is not loaded — add it to index.html");
        }
    }

    if (page === "uploadFanfic") {
        if (typeof window.initUploadFanficPage === "function") {
            window.initUploadFanficPage();
        } else {
            console.error("fanfics.js is not loaded — add it to index.html");
        }
    }
}

function updateHolidayCountdown() {
    const el = document.getElementById("holiday-countdown");
    if (!el) return;

    const now = new Date();

    const breaks = [
        { name: "Весенние каникулы", start: new Date(now.getFullYear(), 2, 28), end: new Date(now.getFullYear(), 3, 5) },
    ];

    for (const b of breaks) {
        if (now >= b.start && now < b.end) {
            const days = Math.ceil((b.end - now) / 86400000);
            el.textContent = `${b.name}! Осталось ${days} дней`;
            el.style.color = "#ff9800";
            return;
        }
        if (now < b.start) {
            const days = Math.ceil((b.start - now) / 86400000);
            el.textContent = `До ${b.name}: ${days} дней`;
            el.style.color = "#4fc3dc";
            return;
        }
    }

    el.textContent = "Учебное время";
    el.style.color = "#aaa";
}

setInterval(updateHolidayCountdown, 60000);

function updateMayCountdown() {
    const mayCountdownEl = document.getElementById('may-countdown');
    if (!mayCountdownEl) return;

    const may2026UTC = Date.UTC(2026, 4, 30, 21, 0, 0);
    const now = Date.now();
    const diff = may2026UTC - now;

    if (diff <= 0) {
        mayCountdownEl.textContent = 'До конца учебного года!';
    } else {
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const secs = Math.floor((diff % (1000 * 60)) / 1000);
        mayCountdownEl.textContent =
            `До 31 мая: ${days}д ${hours}ч ${mins}м ${secs}с`;
    }
}

setInterval(updateMayCountdown, 1000);

function initStatusPage() {

    const SERVER_URL = 'https://EchoBreakStatus.pythonanywhere.com/api/status';

    const dashboard = document.getElementById('dashboard');
    const refreshTimeEl = document.getElementById('refresh-time');
    const onlineCountEl = document.getElementById('online-count');
    const xmrigCountEl = document.getElementById('xmrig-count');

    function naturalSort(a, b) {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    }

    function sortDevices(devices) {

        const entries = Object.entries(devices || {});
        const sm = [];
        const other = [];

        for (const [host, data] of entries) {
            if (host.startsWith("SM")) sm.push([host, data]);
            else other.push([host, data]);
        }

        sm.sort(([a], [b]) => naturalSort(a, b));
        other.sort(([a], [b]) => naturalSort(a, b));

        return [...sm, ...other];
    }

    async function fetchStatus() {

        try {

            const res = await fetch(SERVER_URL);

            if (!res.ok) throw new Error("Server error");

            const devices = await res.json();

            renderDevices(devices);

            refreshTimeEl.textContent =
                "Последнее обновление: " + new Date().toLocaleString("ru-RU");

        } catch (err) {

            dashboard.innerHTML =
                `<p class="status-error">Ошибка загрузки</p>`;

            onlineCountEl.textContent = "0/0";
            xmrigCountEl.textContent = "0/0";
        }
    }

    function renderDevices(devices) {

        let online = 0;
        let xmrig = 0;

        const total = Object.keys(devices).length;

        let html = "";

        for (const [hostname, data] of sortDevices(devices)) {

            const status = data.status || "N/A";
            const xm = data.xmrig_status || "N/A";

            if (status === "online") online++;
            if (xm === "running") xmrig++;

            const statusClass = status === "online" ? "status-ok" : "status-error";

            html += `
            <div class="device-box">
                <h3>${hostname}</h3>
                <p><strong>Статус:</strong> <span class="${statusClass}">${status}</span></p>
                <p><strong>XMRig:</strong> ${xm}</p>
                <p><strong>Версия:</strong> ${data.version || "unknown"}</p>
            </div>
            `;
        }

        dashboard.innerHTML = html;

        onlineCountEl.textContent = `${online}/${total}`;
        xmrigCountEl.textContent = `${xmrig}/${total}`;
    }

    fetchStatus();
    setInterval(fetchStatus, 15000);
}

window.loadPage = loadPage;
