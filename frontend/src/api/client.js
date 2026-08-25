/**
 * Centralized HTTP Client for ODCHS Data Platform
 *
 * Features:
 *  - Automatic JSON request & response serialization.
 *  - CSRF double-submit token extraction from cookies (X-CSRF-TOKEN).
 *  - Single-flight 401 silent token refresh queue & request replay.
 *  - Session expiry event notification (auth:session-expired).
 *  - Native download helper with Content-Disposition filename extraction.
 */

function getCookie(name) {
    if (typeof document === "undefined") return null;
    const match = document.cookie.match(new RegExp("(^|;\\s*)" + name + "=([^;]*)"));
    return match ? decodeURIComponent(match[2]) : null;
}

let isRefreshing = false;
let refreshSubscribers = [];

function subscribeTokenRefresh(cb) {
    refreshSubscribers.push(cb);
}

function onRefreshed(success) {
    refreshSubscribers.forEach((cb) => {
        try {
            cb(success);
        } catch {
            // ignore subscriber errors
        }
    });
    refreshSubscribers = [];
}

async function executeRefreshToken() {
    try {
        const csrfRefresh = getCookie("csrf_refresh_token");
        const headers = {};
        if (csrfRefresh) {
            headers["X-CSRF-TOKEN"] = csrfRefresh;
        }

        const res = await fetch("/api/auth/refresh", {
            method: "POST",
            headers,
        });

        return res.ok;
    } catch {
        return false;
    }
}

/**
 * Universal API Request Helper
 *
 * @param {string} url - Target endpoint path (e.g. "/api/admin/users")
 * @param {RequestInit} options - Standard fetch options
 * @param {number} retryCount - Internal recursion guard for 401 retries
 */
export async function client(url, options = {}, retryCount = 0) {
    const headers = { ...(options.headers || {}) };

    // Auto-detect JSON payload
    if (options.body && typeof options.body === "string" && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }

    // Attach CSRF token on mutating requests if present in cookies
    const method = (options.method || "GET").toUpperCase();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        const isRefreshEndpoint = url.includes("/auth/refresh");
        const csrfCookieName = isRefreshEndpoint ? "csrf_refresh_token" : "csrf_access_token";
        const csrfToken = getCookie(csrfCookieName);
        if (csrfToken && !headers["X-CSRF-TOKEN"]) {
            headers["X-CSRF-TOKEN"] = csrfToken;
        }
    }

    let response;
    try {
        response = await fetch(url, {
            ...options,
            headers,
        });
    } catch (netErr) {
        throw { success: false, msg: netErr?.message || "Network connection error" };
    }

    // ── 401 interception ──────────────────────────────────────────────
    // Runs BEFORE we branch on response type, so file downloads
    // (responseType "blob") get the same silent-refresh-and-replay as JSON
    // requests. A slept laptop wakes with an expired access token: the first
    // call 401s, we refresh once, and replay the ORIGINAL request — options
    // are preserved, so a blob download replays as a blob download.
    const isAuthEndpoint =
        url.includes("/auth/login") ||
        url.includes("/auth/refresh") ||
        url.includes("/auth/me");

    if (response.status === 401 && retryCount === 0 && !isAuthEndpoint) {
        if (!isRefreshing) {
            isRefreshing = true;
            const refreshSuccess = await executeRefreshToken();
            isRefreshing = false;
            onRefreshed(refreshSuccess);

            if (refreshSuccess) {
                // Replay the original request with the fresh token.
                return client(url, options, retryCount + 1);
            }
            // Refresh token is also dead: give up and hand off to login.
            if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("auth:session-expired"));
            }
            throw { success: false, msg: "Session expired. Please log in again." };
        }

        // A refresh is already in flight — queue this request and replay
        // (or reject) it once that refresh resolves.
        return new Promise((resolve, reject) => {
            subscribeTokenRefresh(async (success) => {
                if (success) {
                    try {
                        resolve(await client(url, options, retryCount + 1));
                    } catch (err) {
                        reject(err);
                    }
                } else {
                    reject({ success: false, msg: "Session expired. Please log in again." });
                }
            });
        });
    }

    // ── Blob responses (file downloads) ───────────────────────────────
    // Return the whole Response so the caller can read both the body and the
    // Content-Disposition header. Any 401 was already handled above.
    if (options.responseType === "blob") {
        if (!response.ok) {
            let errData;
            try {
                errData = await response.json();
            } catch {
                errData = { success: false, msg: "Download failed" };
            }
            throw errData;
        }
        return response;
    }

    // ── JSON responses ────────────────────────────────────────────────
    let data;
    try {
        data = await response.json();
    } catch {
        data = { success: response.ok, msg: response.ok ? "Success" : "Invalid server response" };
    }

    if (!response.ok) {
        throw data;
    }

    return data;
}

/**
 * Universal File Download Helper
 *
 * Routes through client() so downloads get the same silent 401 refresh-and-replay
 * as every other request — a slept-laptop expired token refreshes transparently
 * instead of throwing "Token has expired". Extracts the filename from
 * Content-Disposition with a fallback.
 */
export async function downloadFile(url, fallbackName = "download") {
    const response = await client(url, { responseType: "blob" });

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
    const filename = match ? decodeURIComponent(match[1]) : fallbackName;

    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(blobUrl);
}

/**
 * Universal File Upload Helper (with progress tracking)
 *
 * Uses XMLHttpRequest to track upload progress while maintaining the same
 * CSRF and silent 401 refresh-and-replay capabilities as the standard client().
 */
export async function uploadFile(url, options = {}, onProgress = null, retryCount = 0) {
    const headers = { ...(options.headers || {}) };

    const method = (options.method || "POST").toUpperCase();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        const csrfToken = getCookie("csrf_access_token");
        if (csrfToken && !headers["X-CSRF-TOKEN"]) {
            headers["X-CSRF-TOKEN"] = csrfToken;
        }
    }

    let response = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        
        // Apply headers
        for (const [key, value] of Object.entries(headers)) {
            xhr.setRequestHeader(key, value);
        }

        // Setup progress
        if (onProgress && xhr.upload) {
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percentComplete = Math.round((e.loaded / e.total) * 100);
                    onProgress(percentComplete, e.loaded, e.total);
                }
            };
        }

        xhr.onload = () => {
            resolve({
                status: xhr.status,
                ok: xhr.status >= 200 && xhr.status < 300,
                text: () => Promise.resolve(xhr.responseText),
                json: () => {
                    try {
                        return Promise.resolve(JSON.parse(xhr.responseText));
                    } catch {
                        return Promise.reject(new Error("Invalid JSON"));
                    }
                }
            });
        };

        xhr.onerror = () => {
            reject({ success: false, msg: "Network connection error" });
        };

        xhr.send(options.body);
    });

    // ── 401 interception ──────────────────────────────────────────────
    if (response.status === 401 && retryCount === 0) {
        if (!isRefreshing) {
            isRefreshing = true;
            const refreshSuccess = await executeRefreshToken();
            isRefreshing = false;
            onRefreshed(refreshSuccess);

            if (refreshSuccess) {
                return uploadFile(url, options, onProgress, retryCount + 1);
            }
            if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("auth:session-expired"));
            }
            throw { success: false, msg: "Session expired. Please log in again." };
        }

        return new Promise((resolve, reject) => {
            subscribeTokenRefresh(async (success) => {
                if (success) {
                    try {
                        resolve(await uploadFile(url, options, onProgress, retryCount + 1));
                    } catch (err) {
                        reject(err);
                    }
                } else {
                    reject({ success: false, msg: "Session expired. Please log in again." });
                }
            });
        });
    }

    let data;
    try {
        data = await response.json();
    } catch {
        data = { success: response.ok, msg: response.ok ? "Success" : "Invalid server response" };
    }

    if (!response.ok) {
        throw data;
    }

    return data;
}
