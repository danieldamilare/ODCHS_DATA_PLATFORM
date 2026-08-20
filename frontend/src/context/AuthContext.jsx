import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getMe, login as apiLogin, logout as apiLogout, refreshToken } from "../api/auth";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const checkAuth = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getMe();
            if (res.success && res.data?.user) {
                setUser(res.data.user);
                setLoading(false);
                return;
            }
        } catch {
            // Access token might be expired, attempt a refresh
            try {
                const refreshRes = await refreshToken();
                if (refreshRes.success) {
                    const meRes = await getMe();
                    if (meRes.success && meRes.data?.user) {
                        setUser(meRes.data.user);
                        setLoading(false);
                        return;
                    }
                }
            } catch {
                // Not authenticated or refresh token expired
            }
        }
        setUser(null);
        setLoading(false);
    }, []);

    useEffect(() => {
        checkAuth();

        function handleSessionExpired() {
            setUser(null);
            setLoading(false);
        }

        window.addEventListener("auth:session-expired", handleSessionExpired);
        return () => window.removeEventListener("auth:session-expired", handleSessionExpired);
    }, [checkAuth]);

    const login = async (email, password) => {
        const res = await apiLogin({ email, password });
        if (res.success && res.data?.user) {
            setUser(res.data.user);
        }
        return res;
    };

    const logout = async () => {
        try {
            await apiLogout();
        } finally {
            setUser(null);
            setLoading(false);
        }
    };

    const refreshUser = async () => {
        try {
            const res = await getMe();
            if (res.success && res.data?.user) {
                setUser(res.data.user);
            }
        } catch {
            setUser(null);
        }
    };

    const value = {
        user,
        loading,
        isAuthenticated: !!user,
        isAdmin: user?.role === "admin",
        login,
        logout,
        refreshUser,
        checkAuth,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
