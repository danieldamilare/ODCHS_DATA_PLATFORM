import { client } from "./client";

const BASE = "/api/auth";

export async function login({ email, password }) {
    return client(`${BASE}/login`, {
        method: "POST",
        body: JSON.stringify({ email, password }),
    });
}

export async function logout() {
    return client(`${BASE}/logout`, { method: "POST" });
}

export async function getMe() {
    return client(`${BASE}/me`);
}

export async function refreshToken() {
    return client(`${BASE}/refresh`, { method: "POST" });
}

export async function verifyToken(token) {
    return client(`${BASE}/token/${token}`);
}

export async function activateAccount({ token, password }) {
    return client(`${BASE}/activate`, {
        method: "POST",
        body: JSON.stringify({ token, password }),
    });
}

export async function requestReset(email) {
    return client(`${BASE}/reset`, {
        method: "POST",
        body: JSON.stringify({ email }),
    });
}

export async function confirmReset({ token, password }) {
    return client(`${BASE}/reset/confirm`, {
        method: "POST",
        body: JSON.stringify({ token, password }),
    });
}

export async function changePassword({ old_password, new_password }) {
    return client(`${BASE}/change-password`, {
        method: "POST",
        body: JSON.stringify({ old_password, new_password }),
    });
}
