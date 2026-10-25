/**
 * fanfics.js — Client-side logic for /fanfics and /uploadFanfic pages.
 *
 * HOW IT PLUGS IN:
 *   1. Add  <script src="/static/js/fanfics.js"></script>  to your index.html
 *   2. In app.js → initPageScripts(), add:
 *        if (page === 'fanfics')      window.initFanficsPage();
 *        if (page === 'uploadFanfic') window.initUploadFanficPage();
 *
 * Token auth: reads  localStorage.getItem('token')  (same as auth.js)
 *
 * CHANGES applied:
 *   1. buildFanficCard   — horizontal layout: image left, info middle, stats right.
 *   2. renderFanficModal — new header layout (author|title|close row + meta + star btn).
 *   3. Unique views removed from all user-visible strings (total views only).
 *   4. Button bar remapped in fanfics.html (no JS change needed beyond ID matching).
 *   5. Light/reading-mode toggle removed (no .light-mode class applied anywhere).
 */

(function () {
    "use strict";

    // ── Auth helper ─────────────────────────────────────────────────────────────

    /** Build common auth headers. Returns null when not logged in. */
    function authHeaders() {
        const token = localStorage.getItem("token");
        return token ? { Authorization: "Bearer " + token } : null;
    }

    /** Redirect to /login when the response is 401 Unauthorized. */
    function handleUnauth(res) {
        if (res.status === 401) {
            window.location.href = "/login";
            throw new Error("Unauthorized");
        }
        return res;
    }


    // ══════════════════════════════════════════════════════════════════════════
    //  FANFICS PAGE
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Entry-point called by initPageScripts('fanfics') in app.js.
     * Attaches all event listeners and triggers the initial fanfic load.
     */
    window.initFanficsPage = function () {
        const headers = authHeaders();
        if (!headers) {
            window.location.href = "/login";
            return;
        }

        // ── Button wiring ──────────────────────────────────────────────────
        // "Избранное" button (change 4: was viewStarredButton, label was "Избранные фанфики")
        document.getElementById("viewStarredButton")
            ?.addEventListener("click", () => openStarredModal(headers));

        // "Статистика" button (change 4: was viewStatsButton, label was "Статистика просмотров")
        document.getElementById("viewStatsButton")
            ?.addEventListener("click", () => openStatsModal(headers));

        // Close any modal when clicking its ✕ button
        document.querySelectorAll(".close-modal").forEach(btn => {
            btn.onclick = () => closeModal(btn.closest(".modal"));
        });

        // Close any modal when clicking the dark backdrop
        window.onclick = e => {
            if (e.target.classList.contains("modal")) closeModal(e.target);
        };

        loadFanficsGrid(headers);
    };


    // ── Grid loading ─────────────────────────────────────────────────────────

    async function loadFanficsGrid(headers) {
        const container = document.getElementById("gistsList");
        if (!container) return;

        container.innerHTML = "<p>Загрузка фанфиков…</p>";

        try {
            const res = await fetch("/api/fanfics", { headers }).then(handleUnauth);
            if (!res.ok) throw new Error((await res.json()).error || res.statusText);
            const list = await res.json();

            if (!list.length) {
                container.innerHTML = "<p>Пока нет ни одного фанфика.</p>";
                return;
            }

            container.innerHTML = "";
            for (const f of list) {
                container.appendChild(buildFanficCard(f, headers));
            }
        } catch (err) {
            if (err.message !== "Unauthorized") {
                container.innerHTML = `<p style="color:#f66">Ошибка: ${err.message}</p>`;
            }
        }
    }


    /**
     * Build and return a single fanfic card DOM element.
     *
     * CHANGE 1 — horizontal layout:
     *   [image (left)] | [title + author (middle)] | [views + stars (right)]
     *   [Читать button — full width at bottom]
     *
     * CHANGE 3 — unique views removed; only total_views is shown.
     */
    function buildFanficCard(f, headers) {
        const nsfwBadge = f.nsfw
            ? '<span class="nsfw-badge">NSFW</span>'
            : "";

        const card = document.createElement("div");
        card.className = "fanfic-card";
        card.innerHTML = `
            <!-- Horizontal body: image | info | stats -->
            <div class="fanfic-card-body">
                <!-- Left: cover image with optional NSFW badge -->
                <div style="position:relative; flex-shrink:0;">
                    <img src="${escHtml(f.cover_url)}"
                         alt="Обложка"
                         class="fanfic-image"
                         loading="lazy"
                         onerror="this.src='/static/images/placeholder.jpg'">
                    ${nsfwBadge}
                </div>

                <!-- Middle: title and author -->
                <div class="fanfic-card-info">
                    <p class="fanfic-card-title"><strong>${escHtml(f.title)}</strong></p>
                    <p class="fanfic-card-author">${escHtml(f.author_name)}</p>
                </div>

                <!-- Right: views (total only, change 3) and star count -->
                <div class="fanfic-card-stats">
                    <span>👁 ${f.total_views}</span>
                    <span>★ ${f.star_count}</span>
                </div>
            </div>

            <!-- Read button spans full card width -->
            <div class="card-actions">
                <button class="read-button">Читать</button>
            </div>
        `;

        card.querySelector(".read-button").addEventListener("click", () => {
            openFanficModal(f.id, headers);
        });

        return card;
    }


    // ── Fanfic reader modal ──────────────────────────────────────────────────

    /**
     * Fetch full content, handle NSFW gate, then render the reader modal.
     */
    async function openFanficModal(fanficId, headers) {
        try {
            const res = await fetch(`/api/fanfics/${fanficId}`, { headers })
                .then(handleUnauth);
            if (!res.ok) throw new Error((await res.json()).error || res.statusText);
            const f = await res.json();

            if (f.nsfw) {
                showNsfwWarning(() => renderFanficModal(f, headers));
            } else {
                renderFanficModal(f, headers);
            }
        } catch (err) {
            if (err.message !== "Unauthorized") alert(`Ошибка загрузки: ${err.message}`);
        }
    }


    /**
     * Populate and open the full-screen reader modal.
     *
     * CHANGE 2 — new header layout:
     *   Row 1: [Автор btn] [Title centered] [✕ close]
     *   Row 2: date string
     *   Row 3: views count (total only — change 3)
     *   Row 4: "Добавить / Удалить из избранного" full-width button
     *
     * CHANGE 5 — reading-mode toggle (◐) removed; only dark mode exists.
     */
    function renderFanficModal(f, headers) {
        // ── Fill header meta ───────────────────────────────────────────────

        // Title in the centered h2 of the title row
        document.getElementById("fanficTitle").textContent = f.title;

        // Author + date line
        document.getElementById("fanficAuthorDate").textContent =
            `Дата: ${fmtDate(f.created_at)}`;

        // Views — total only (change 3: unique views removed)
        document.getElementById("fanficStats").textContent =
            `Просмотров: ${f.total_views}`;

        // ── Star / favourite button (change 2) ────────────────────────────
        const starBtn = document.getElementById("starButton");
        updateStarButton(starBtn, f.is_starred);
        starBtn.onclick = () => toggleStar(f.id, starBtn, headers);

        // ── Author button (now lives in modal-title-row) ──────────────────
        document.getElementById("viewAuthorButton").onclick = () =>
            openAuthorModal(f.author_id, headers);

        // ── Re-wire the close button that lives inside the title row ──────
        // The generic querySelectorAll in initFanficsPage already handles it,
        // but re-wiring here ensures correctness after DOM re-use.
        const closeBtn = document.querySelector("#fanficModal .modal-title-row .close-modal");
        if (closeBtn) {
            closeBtn.onclick = () => closeModal(document.getElementById("fanficModal"));
        }

        // ── Render markdown body ──────────────────────────────────────────
        document.getElementById("fanficContent").innerHTML = markdownToHtml(f.content);

        openModal(document.getElementById("fanficModal"));

        // Record view (fire-and-forget; we don't await or show errors to the user)
        fetch(`/api/fanfics/${f.id}/view`, { method: "POST", headers }).catch(() => { });
    }


    /**
     * Update the star/favourite button label and visual state.
     * @param {HTMLButtonElement} btn
     * @param {boolean} isStarred
     */
    function updateStarButton(btn, isStarred) {
        if (isStarred) {
            btn.textContent = "★ Удалить из избранного";
            btn.classList.add("starred");
        } else {
            btn.textContent = "☆ Добавить в избранное";
            btn.classList.remove("starred");
        }
    }


    // ── Star / bookmark ──────────────────────────────────────────────────────

    async function toggleStar(fanficId, button, headers) {
        try {
            const res = await fetch(`/api/fanfics/${fanficId}/star`, {
                method: "POST",
                headers,
            }).then(handleUnauth);
            if (!res.ok) throw new Error((await res.json()).error || res.statusText);
            const { starred } = await res.json();
            updateStarButton(button, starred);
        } catch (err) {
            if (err.message !== "Unauthorized") alert(`Ошибка: ${err.message}`);
        }
    }


    // ── Author modal ─────────────────────────────────────────────────────────

    async function openAuthorModal(authorId, headers) {
        const modal = document.getElementById("authorModal");
        const nameEl = document.getElementById("authorName");
        const statsEl = document.getElementById("authorStats");
        const listEl = document.getElementById("authorFanfics");

        nameEl.textContent = "Загрузка…";
        statsEl.innerHTML = "";
        listEl.innerHTML = "";
        openModal(modal);

        try {
            const res = await fetch(`/api/fanfics/author/${authorId}`, { headers })
                .then(handleUnauth);
            if (!res.ok) throw new Error((await res.json()).error || res.statusText);
            const data = await res.json();

            nameEl.textContent = data.author.username;

            const s = data.stats;
            // Unique views omitted from author stats display (change 3)
            statsEl.innerHTML = `
                <p><strong>Фанфиков:</strong> ${s.total_fanfics}</p>
                <p><strong>Всего слов:</strong> ${fmtNum(s.total_words)}</p>
                <p><strong>Просмотров:</strong> ${fmtNum(s.total_views)}</p>
                <p><strong>Среднее слов:</strong> ${fmtNum(s.avg_words)}</p>
                <p><strong>Первый фанфик:</strong> ${fmtDate(s.first_date)}</p>
            `;

            if (!data.fanfics.length) {
                listEl.innerHTML = "<p>Нет фанфиков.</p>";
                return;
            }

            for (const w of data.fanfics) {
                const item = document.createElement("div");
                item.className = "author-fanfic-item";
                // Unique views omitted (change 3); show total only
                item.innerHTML = `
                    <h4>${escHtml(w.title)}</h4>
                    <p>${fmtDate(w.created_at)} • ${fmtNum(w.approx_words)} слов • ${w.total_views} просм.</p>
                    <button class="read-button-small">Читать</button>
                `;
                item.querySelector(".read-button-small").onclick = () =>
                    openFanficModal(w.id, headers);
                listEl.appendChild(item);
            }
        } catch (err) {
            if (err.message !== "Unauthorized") {
                statsEl.innerHTML = `<p style="color:#f66">Ошибка: ${err.message}</p>`;
            }
        }
    }


    // ── Starred modal ────────────────────────────────────────────────────────

    async function openStarredModal(headers) {
        const modal = document.getElementById("starredModal");
        const list = document.getElementById("starredFanficsList");
        list.innerHTML = "<p>Загрузка…</p>";
        openModal(modal);

        try {
            const res = await fetch("/api/fanfics/starred", { headers })
                .then(handleUnauth);
            if (!res.ok) throw new Error((await res.json()).error || res.statusText);
            const fanfics = await res.json();

            if (!fanfics.length) {
                list.innerHTML = "<p>У вас пока нет избранных фанфиков.</p>";
                return;
            }

            list.innerHTML = "";
            for (const f of fanfics) {
                const el = document.createElement("div");
                el.className = "fanfic-card starred-item";
                // Unique views omitted (change 3)
                el.innerHTML = `
                    <img src="${escHtml(f.cover_url)}"
                         alt="Обложка" class="fanfic-image"
                         loading="lazy"
                         onerror="this.src='/static/images/placeholder.jpg'">
                    <h4>${escHtml(f.title)}</h4>
                    <p>Автор: ${escHtml(f.author_name)}</p>
                    <p>Дата: ${fmtDate(f.created_at)}</p>
                    <p>${f.total_views} просм.</p>
                    <button class="read-button" style="margin-bottom:6px">Читать</button>
                    <button class="remove-star-button">Удалить из избранного</button>
                `;
                el.querySelector(".read-button").onclick = () =>
                    openFanficModal(f.id, headers);
                el.querySelector(".remove-star-button").onclick = async () => {
                    await fetch(`/api/fanfics/${f.id}/star`, { method: "POST", headers });
                    openStarredModal(headers);   // refresh the list
                };
                list.appendChild(el);
            }
        } catch (err) {
            if (err.message !== "Unauthorized") {
                list.innerHTML = `<p style="color:#f66">Ошибка: ${err.message}</p>`;
            }
        }
    }


    // ── Stats modal ──────────────────────────────────────────────────────────

    async function openStatsModal(headers) {
        const modal = document.getElementById("statsModal");
        const el = document.getElementById("globalStats");
        el.textContent = "Загрузка…";
        openModal(modal);

        try {
            const res = await fetch("/api/fanfics/global-stats", { headers })
                .then(handleUnauth);
            if (!res.ok) throw new Error((await res.json()).error || res.statusText);
            const s = await res.json();

            el.innerHTML = `
                <p><strong>Всего фанфиков:</strong> ${s.fanfic_count}</p>
                <p><strong>Общие просмотры:</strong> ${fmtNum(s.total_views)}</p>
                ${s.top_fanfic
                    ? `<p><strong>Самый популярный:</strong> ${escHtml(s.top_fanfic.title)} (${s.top_fanfic.views} просм.)</p>`
                    : ""}
            `;
        } catch (err) {
            if (err.message !== "Unauthorized") {
                el.innerHTML = `<p style="color:#f66">Ошибка: ${err.message}</p>`;
            }
        }
    }


    // ── NSFW gate ────────────────────────────────────────────────────────────

    function showNsfwWarning(onConfirm) {
        const modal = document.getElementById("nsfwWarningModal");
        const confirmBtn = document.getElementById("showNsfwContent");
        const cancelBtn = document.getElementById("cancelNsfw");

        // Remove any leftover one-time listeners from a previous call
        const freshConfirm = confirmBtn.cloneNode(true);
        const freshCancel = cancelBtn.cloneNode(true);
        confirmBtn.replaceWith(freshConfirm);
        cancelBtn.replaceWith(freshCancel);

        freshConfirm.addEventListener("click", () => {
            closeModal(modal);
            onConfirm();
        });
        freshCancel.addEventListener("click", () => closeModal(modal));

        openModal(modal);
    }


    // ══════════════════════════════════════════════════════════════════════════
    //  UPLOAD FANFIC PAGE
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Entry-point called by initPageScripts('uploadFanfic') in app.js.
     */
    window.initUploadFanficPage = function () {
        const headers = authHeaders();
        if (!headers) {
            window.location.href = "/login";
            return;
        }

        const msgEl = document.getElementById("uploadMessage");
        const preview = document.getElementById("coverPreview");

        if (!document.getElementById("uploadTitle")) return; // page not loaded

        // Live cover image preview
        document.getElementById("coverImage")?.addEventListener("change", function () {
            const file = this.files[0];
            if (!file || !preview) return;
            const url = URL.createObjectURL(file);
            preview.src = url;
            preview.style.display = "block";
        });

        // uploadForm is a <div>, so attach to the submit button's click instead
        document.getElementById("submitUpload")
            ?.addEventListener("click", async () => handleUpload(headers, msgEl));
    };


    async function handleUpload(headers, msgEl) {
        const title = (document.getElementById("uploadTitle")?.value || "").trim();
        const content = (document.getElementById("uploadText")?.value || "").trim();
        const nsfw = document.getElementById("nsfwCheckbox")?.checked ?? false;
        const coverInput = document.getElementById("coverImage");

        if (!title) { showMsg(msgEl, "Введите заголовок.", true); return; }
        if (!content) { showMsg(msgEl, "Введите текст фанфика.", true); return; }

        // Build multipart payload
        const data = new FormData();
        data.append("title", title);
        data.append("content", content);
        data.append("nsfw", nsfw ? "true" : "false");

        const coverFile = coverInput?.files[0];
        if (coverFile) {
            // Validate size before sending
            if (coverFile.size > 5 * 1024 * 1024) {
                showMsg(msgEl, "Обложка слишком большая (макс. 5 МБ).", true);
                return;
            }
            data.append("cover", coverFile);
        }

        showMsg(msgEl, "Загрузка…", false);

        // Note: do NOT set Content-Type manually for FormData — browser sets boundary
        const fetchHeaders = { Authorization: headers.Authorization };

        try {
            const res = await fetch("/api/fanfics", {
                method: "POST",
                headers: fetchHeaders,
                body: data,
            });

            if (res.status === 401) { window.location.href = "/login"; return; }

            const json = await res.json();
            if (!res.ok) throw new Error(json.error || res.statusText);

            showMsg(msgEl, "Фанфик загружен! Перенаправление…", false);
            setTimeout(() => history.pushState({}, "", "/fanfics") || window.loadPage("fanfics"), 1500);

        } catch (err) {
            showMsg(msgEl, `Ошибка: ${err.message}`, true);
        }
    }


    // ══════════════════════════════════════════════════════════════════════════
    //  SHARED UTILITIES
    // ══════════════════════════════════════════════════════════════════════════

    /** Open a modal (set display:block). */
    function openModal(modal) {
        if (modal) modal.style.display = "block";
    }

    /** Close a modal. */
    function closeModal(modal) {
        if (modal) modal.style.display = "none";
    }

    /**
     * Minimal Markdown→HTML renderer matching the original fanfic format.
     * Handles: headings (#, ##, ###), lists (*, -), ordered lists,
     *          blockquotes (>), horizontal rules (---/***), and paragraphs.
     */
    function markdownToHtml(text) {
        if (!text) return "";
        const lines = text.split("\n");
        let html = "";
        let inUl = false, inOl = false;

        const closeOpen = () => {
            if (inUl) { html += "</ul>"; inUl = false; }
            if (inOl) { html += "</ol>"; inOl = false; }
        };

        for (let raw of lines) {
            const line = raw.trim();

            if (line.startsWith("###")) {
                closeOpen();
                html += `<h4>${escHtml(line.slice(3).trim())}</h4>`;
            } else if (line.startsWith("##")) {
                closeOpen();
                html += `<h3>${escHtml(line.slice(2).trim())}</h3>`;
            } else if (line.startsWith("#")) {
                closeOpen();
                html += `<h2>${escHtml(line.slice(1).trim())}</h2>`;
            } else if (line.startsWith("* ") || line.startsWith("- ")) {
                if (!inUl) { html += "<ul>"; inUl = true; }
                html += `<li>${escHtml(line.slice(2).trim())}</li>`;
            } else if (/^\d+\.\s/.test(line)) {
                if (!inOl) { html += "<ol>"; inOl = true; }
                html += `<li>${escHtml(line.replace(/^\d+\.\s*/, "").trim())}</li>`;
            } else if (line === "---" || line === "***") {
                closeOpen();
                html += "<hr>";
            } else if (line.startsWith(">")) {
                closeOpen();
                html += `<blockquote>${escHtml(line.slice(1).trim())}</blockquote>`;
            } else if (line) {
                closeOpen();
                html += `<p>${escHtml(line)}</p>`;
            } else {
                closeOpen();
                html += "<br>";
            }
        }
        closeOpen();
        return html;
    }

    /** Escape HTML special characters to prevent XSS in user content. */
    function escHtml(str) {
        if (str == null) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    /** Format an ISO date string for Russian locale. */
    function fmtDate(iso) {
        if (!iso) return "—";
        try {
            return new Date(iso).toLocaleString("ru-RU");
        } catch {
            return iso;
        }
    }

    /** Format a number with Russian locale separators. */
    function fmtNum(n) {
        return (n ?? 0).toLocaleString("ru-RU");
    }

    /** Show a status message (red on error, white otherwise). */
    function showMsg(el, text, isError) {
        if (!el) return;
        el.textContent = text;
        el.style.color = isError ? "#f66" : "#ccc";
    }

})();