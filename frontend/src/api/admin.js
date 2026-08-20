import { client } from "./client";

const BASE = "/api/admin";

export async function getUsers({ page = 1, count = 10, status = null } = {}) {
    const params = new URLSearchParams({ page, count });
    if (status && status !== "all") {
        params.append("status", status);
    }
    return client(`${BASE}/users?${params.toString()}`);
}

export async function getUser(userId) {
    return client(`${BASE}/users/${userId}`);
}

export async function createUser(userData) {
    return client(`${BASE}/users`, {
        method: "POST",
        body: JSON.stringify(userData),
    });
}

export async function deactivateUser(userId) {
    return client(`${BASE}/users/${userId}/deactivate`, {
        method: "POST",
    });
}

export async function reactivateUser(userId, expiryDate = null) {
    const body = expiryDate ? JSON.stringify({ expiry_date: expiryDate }) : null;
    return client(`${BASE}/users/${userId}/reactivate`, {
        method: "POST",
        body,
    });
}

export async function resendActivation(userId) {
    return client(`${BASE}/users/${userId}/resend-activation`, {
        method: "POST",
    });
}

export async function cancelActivation(userId) {
    return client(`${BASE}/users/${userId}/cancel-activation`, {
        method: "POST",
    });
}
