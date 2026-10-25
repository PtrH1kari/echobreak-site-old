////////////////////////////////////////////////////////////
// EchoBreak JWT Auth System (SPA compatible)
////////////////////////////////////////////////////////////

const API = "/api";

////////////////////////////////////////////////////////////
// TOKEN
////////////////////////////////////////////////////////////

function saveToken(token) {
    localStorage.setItem("token", token);
}

function getToken() {
    return localStorage.getItem("token");
}

function logout() {
    localStorage.removeItem("token");
    navigate("login");
}

////////////////////////////////////////////////////////////
// API REQUEST
////////////////////////////////////////////////////////////

async function api(path, method = "GET", body = null) {
    const headers = {
        "Content-Type": "application/json"
    };

    const token = getToken();
    if (token)
        headers["Authorization"] = "Bearer " + token;

    const res = await fetch(API + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null
    });

    let data;

    try {
        data = await res.json();
    } catch {
        return { error: "Server error" };
    }

    if (!res.ok) {
        return data;
    }

    return data;
}

////////////////////////////////////////////////////////////
// NAVIGATION
////////////////////////////////////////////////////////////

function navigate(page) {
    history.pushState({}, "", "/" + page);
    window.loadPage(page);
}

////////////////////////////////////////////////////////////
// LOGIN + REGISTER HANDLER
////////////////////////////////////////////////////////////

document.addEventListener("submit", async (e) => {
    const form = e.target;

    ////////////////////////////////////////
    // LOGIN
    ////////////////////////////////////////

    if (form.id === "loginForm") {
        e.preventDefault();

        const username = form.querySelector("#name").value;
        const password = form.querySelector("#password").value;
        const msg = form.querySelector("#msg");

        msg.innerText = "Вход...";

        const res = await api("/login", "POST", {
            username,
            password
        });

        if (res.token) {
            saveToken(res.token);
            navigate("account");
        }
        else {
            msg.innerText = res.error || "Ошибка входа";
        }
    }

    ////////////////////////////////////////
    // REGISTER
    ////////////////////////////////////////

    if (form.id === "registerForm") {
        e.preventDefault();

        const username = form.querySelector("#name").value;
        const password = form.querySelector("#password").value;
        const password2 = form.querySelector("#password2").value;
        const msg = form.querySelector("#msg");

        if (password !== password2) {
            msg.innerText = "Пароли не совпадают";
            return;
        }

        msg.innerText = "Регистрация...";

        const res = await api("/register", "POST", {
            username,
            password
        });

        if (res.token) {
            saveToken(res.token);
            navigate("account");
        }
        else {
            msg.innerText = res.error || "Ошибка регистрации";
        }
    }

    ////////////////////////////////////////
    // CHANGE PASSWORD
    ////////////////////////////////////////

    if (form.id === "changePasswordForm") {

        e.preventDefault();

        const old_password = form.querySelector("#oldPassword").value;
        const new_password = form.querySelector("#newPassword").value;
        const new_password2 = form.querySelector("#newPassword2").value;
        const msg = form.querySelector("#msg");

        //////////////////////////////////////
        // CLIENT VALIDATION
        //////////////////////////////////////

        if (new_password !== new_password2) {
            msg.innerText = "Новые пароли не совпадают";
            return;
        }

        if (new_password.length < 6) {
            msg.innerText = "Пароль слишком короткий";
            return;
        }

        msg.innerText = "Обновление...";

        const res = await api("/change-password", "POST", {
            old_password,
            new_password
        });

        //////////////////////////////////////
        // SUCCESS
        //////////////////////////////////////

        if (res.success) {

            msg.innerText = "Пароль успешно изменён";

            setTimeout(() => {
                navigate("account");
            }, 1200);

        }
        else {
            msg.innerText = res.error || "Ошибка";
        }
    }
});

////////////////////////////////////////////////////////////
// PAGE INIT
////////////////////////////////////////////////////////////

document.addEventListener("pageLoaded", async (event) => {
    const page = event.detail.page;

    ////////////////////////////////////////
    // ACCOUNT PAGE INIT
    ////////////////////////////////////////

    if (page === "account") {
        const token = getToken();

        if (!token) {
            navigate("login");
            return;
        }

        const user = await api("/me");

        ////////////////////////////////////////
        // SET DATA
        ////////////////////////////////////////

        const nameField = document.getElementById("nameField");
        const roleField = document.getElementById("role");
        const avatar = document.getElementById("user-avatar");

        if (nameField)
            nameField.innerText = user.username;

        if (roleField)
            roleField.innerText = user.role;

        if (avatar && user.avatar)
            avatar.src = user.avatar;

        ////////////////////////////////////////
        // AVATAR UPLOAD
        ////////////////////////////////////////

        const addPhotoButton = document.getElementById("addPhotoButton");
        const avatarInput = document.getElementById("avatarInput");

        if (addPhotoButton && avatarInput) {

            // Clicking the visible button triggers the hidden file input
            addPhotoButton.addEventListener("click", () => {
                avatarInput.click();
            });

            // As soon as the user picks a file, upload it immediately
            avatarInput.addEventListener("change", async () => {
                const file = avatarInput.files[0];

                if (!file) return;

                // Client-side size guard (5 MB)
                if (file.size > 5 * 1024 * 1024) {
                    alert("Файл слишком большой. Максимум 5 МБ.");
                    avatarInput.value = "";
                    return;
                }

                addPhotoButton.disabled = true;
                addPhotoButton.innerText = "Загрузка...";

                try {
                    // Avatar upload must use FormData, NOT JSON
                    const formData = new FormData();
                    formData.append("avatar", file);

                    const res = await fetch("/api/upload-avatar", {
                        method: "POST",
                        headers: {
                            // NOTE: Do NOT set Content-Type here —
                            // the browser sets it automatically with the correct boundary
                            "Authorization": "Bearer " + getToken()
                        },
                        body: formData
                    });

                    const data = await res.json();

                    if (data.avatar) {
                        // Update both the account page avatar and the header avatar
                        if (avatar) avatar.src = data.avatar + "?t=" + Date.now();

                        const headerAvatar = document.getElementById("header-avatar");
                        if (headerAvatar) headerAvatar.src = data.avatar + "?t=" + Date.now();
                    } else {
                        alert("Ошибка: " + (data.error || "Неизвестная ошибка"));
                    }

                } catch (err) {
                    alert("Ошибка загрузки: " + err.message);
                } finally {
                    addPhotoButton.disabled = false;
                    addPhotoButton.innerText = "Добавить фото";
                    // Reset so the same file can be re-selected if needed
                    avatarInput.value = "";
                }
            });
        }

        ////////////////////////////////////////
        // ACTIVATION KEY
        ////////////////////////////////////////

        const keyInput = document.getElementById("activationKeyInput");
        // Select by class since the button has no id
        const keyButton = document.querySelector(".verify-key-button");

        if (keyInput && keyButton) {

            if (user.activation_key) {

                keyInput.value = user.activation_key;
                keyInput.disabled = true;

                if (keyButton && keyButton.parentElement) {
                    keyButton.parentElement.removeChild(keyButton);
                }

            }

            keyButton.addEventListener("click", async () => {
                const key = keyInput.value.trim();

                if (!key) {
                    alert("Введите ключ активации");
                    return;
                }

                keyButton.disabled = true;
                keyButton.innerText = "...";

                const res = await api("/activate-key", "POST", { key });

                if (res.success) {
                    keyInput.disabled = true;
                    if (keyButton && keyButton.parentElement) {
                        keyButton.parentElement.removeChild(keyButton);
                    }
                    alert("Ключ успешно активирован!");
                } else {
                    keyButton.disabled = false;
                    keyButton.innerText = "v";
                    alert("Ошибка: " + (res.error || "Неизвестная ошибка"));
                }
            });
        }

        ////////////////////////////////////////
        // LOGOUT BUTTON
        ////////////////////////////////////////

        const logoutBtn = document.getElementById("logout");

        if (logoutBtn) {
            logoutBtn.onclick = logout;
        }
    }

    ////////////////////////////////////////
    // UPDATE HEADER AVATAR
    ////////////////////////////////////////

    updateHeaderAvatar();
});

////////////////////////////////////////////////////////////
// HEADER AVATAR
////////////////////////////////////////////////////////////

async function updateHeaderAvatar() {
    const avatar = document.getElementById("header-avatar");

    if (!avatar)
        return;

    const token = getToken();

    if (!token)
        return;

    try {
        const user = await api("/me");

        if (user.avatar)
            avatar.src = user.avatar;
    }
    catch { }
}

////////////////////////////////////////////////////////////
// AUTO INIT ON FIRST LOAD
////////////////////////////////////////////////////////////

document.addEventListener("DOMContentLoaded", updateHeaderAvatar);