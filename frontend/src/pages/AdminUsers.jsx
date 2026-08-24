import { useState, useEffect, useRef } from "react";
import { getUsers, deactivateUser, resendActivation, cancelActivation } from "../api/admin";
import StatusBadge from "../components/ui/StatusBadge";
import InviteUserDrawer from "../components/admin/InviteUserDrawer";
import ReactivateUserModal from "../components/admin/ReactivateUserModal";
import { useToast } from "../components/ui/Toast";
import {
    Plus,
    Users,
    MoreHorizontal,
    Mail,
    UserX,
    UserCheck,
    Trash2,
    Shield,
    Calendar,
    ChevronLeft,
    ChevronRight,
    Loader2,
} from "lucide-react";

const STATUS_TABS = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "pending", label: "Pending" },
    { id: "deactivated", label: "Deactivated" },
];

export default function AdminUsers() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalUsers, setTotalUsers] = useState(0);
    const [statusFilter, setStatusFilter] = useState("all");

    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [reactivatingUser, setReactivatingUser] = useState(null);

    const toast = useToast();

    useEffect(() => {
        loadUsers(page, statusFilter);
    }, [page, statusFilter]);

    async function loadUsers(p, status) {
        setLoading(true);
        try {
            const res = await getUsers({ page: p, count: 10, status });
            if (res.success && res.data) {
                setUsers(res.data.users || []);
                setTotalPages(res.data.pages || 1);
                setTotalUsers(res.data.total || 0);
            } else {
                setUsers([]);
            }
        } catch {
            setUsers([]);
            toast?.error?.("Failed to fetch users");
        } finally {
            setLoading(false);
        }
    }

    function handleTabChange(tabId) {
        setStatusFilter(tabId);
        setPage(1);
    }

    async function handleResend(user) {
        try {
            const res = await resendActivation(user.uuid);
            if (res.success) {
                toast?.success?.(res.msg || `Invitation resent to ${user.email}`);
            } else {
                toast?.error?.(res.msg || "Failed to resend invitation");
            }
        } catch (err) {
            toast?.error?.(err?.msg || "Failed to resend invitation");
        }
    }

    async function handleCancel(user) {
        if (!confirm(`Are you sure you want to cancel the invitation for ${user.first_name} ${user.last_name}?`)) {
            return;
        }
        try {
            const res = await cancelActivation(user.uuid);
            if (res.success) {
                toast?.success?.(res.msg || "Invitation cancelled");
                loadUsers(page, statusFilter);
            } else {
                toast?.error?.(res.msg || "Failed to cancel invitation");
            }
        } catch (err) {
            toast?.error?.(err?.msg || "Failed to cancel invitation");
        }
    }

    async function handleDeactivate(user) {
        if (!confirm(`Are you sure you want to deactivate ${user.first_name} ${user.last_name}'s account?`)) {
            return;
        }
        try {
            const res = await deactivateUser(user.uuid);
            if (res.success) {
                toast?.success?.(res.msg || "User deactivated");
                loadUsers(page, statusFilter);
            } else {
                toast?.error?.(res.msg || "Failed to deactivate user");
            }
        } catch (err) {
            toast?.error?.(err?.msg || "Failed to deactivate user");
        }
    }

    return (
        <div className="p-4 md:p-8 space-y-6 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold gradient-text inline-block">User Management</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Manage staff accounts, invitations, and access permissions
                    </p>
                </div>
                <button
                    onClick={() => setIsDrawerOpen(true)}
                    className="flex items-center gap-2 gradient-primary rounded-xl text-white px-5 py-2.5 text-sm font-semibold hover:shadow-lg hover:shadow-primary-500/25 transition-all self-start sm:self-auto cursor-pointer"
                >
                    <Plus size={16} />
                    Invite User
                </button>
            </div>

            {/* Status Filter Tabs */}
            <div className="inline-flex rounded-xl bg-slate-100 p-1">
                {STATUS_TABS.map((tab) => {
                    const active = statusFilter === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => handleTabChange(tab.id)}
                            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all cursor-pointer ${
                                active
                                    ? "bg-white text-slate-900 shadow-sm"
                                    : "text-slate-500 hover:text-slate-700"
                            }`}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* User List Table */}
            <div className="card overflow-hidden">
                {loading ? (
                    <div className="p-16 text-center">
                        <div className="inline-block w-6 h-6 border-2 border-slate-200 border-t-primary-500 rounded-full animate-spin" />
                    </div>
                ) : users.length === 0 ? (
                    <div className="p-16 text-center">
                        <Users size={40} className="mx-auto mb-3 text-slate-300" />
                        <p className="text-slate-500 font-medium">No users found</p>
                        <p className="text-xs text-slate-400 mt-1">
                            {statusFilter !== "all"
                                ? `No users matching the "${statusFilter}" status filter`
                                : "Invite staff members to get started"}
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100/80">
                                        <th className="px-3 md:px-6 py-3.5 font-semibold">User</th>
                                        <th className="px-3 md:px-6 py-3.5 font-semibold">Role</th>
                                        <th className="px-3 md:px-6 py-3.5 font-semibold">Status</th>
                                        <th className="px-3 md:px-6 py-3.5 font-semibold hidden sm:table-cell">Expires</th>
                                        <th className="px-3 md:px-6 py-3.5 text-right font-semibold">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map((user, idx) => (
                                        <UserRow
                                            key={user.uuid || user.id}
                                            user={user}
                                            isLastRow={idx === users.length - 1 || (idx >= users.length - 2 && users.length <= 2)}
                                            onResend={() => handleResend(user)}
                                            onCancel={() => handleCancel(user)}
                                            onDeactivate={() => handleDeactivate(user)}
                                            onReactivate={() => setReactivatingUser(user)}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination Footer */}
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-4 border-t border-slate-100/80">
                            <span className="text-xs text-slate-400 font-medium">
                                Showing {users.length} of {totalUsers} users
                            </span>

                            {totalPages > 1 && (
                                <div className="flex items-center gap-2">
                                    <button
                                        disabled={page <= 1}
                                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                                        className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-xl border border-slate-200 disabled:opacity-40 hover:bg-slate-50 font-medium text-slate-600 transition-all cursor-pointer disabled:cursor-not-allowed"
                                    >
                                        <ChevronLeft size={14} />
                                        Previous
                                    </button>
                                    <span className="text-xs text-slate-500 font-semibold px-2">
                                        {page} / {totalPages}
                                    </span>
                                    <button
                                        disabled={page >= totalPages}
                                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                        className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-xl border border-slate-200 disabled:opacity-40 hover:bg-slate-50 font-medium text-slate-600 transition-all cursor-pointer disabled:cursor-not-allowed"
                                    >
                                        Next
                                        <ChevronRight size={14} />
                                    </button>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Invite Drawer */}
            <InviteUserDrawer
                isOpen={isDrawerOpen}
                onClose={() => setIsDrawerOpen(false)}
                onUserCreated={() => loadUsers(page, statusFilter)}
            />

            {/* Reactivate Modal */}
            <ReactivateUserModal
                user={reactivatingUser}
                isOpen={!!reactivatingUser}
                onClose={() => setReactivatingUser(null)}
                onUserReactivated={() => loadUsers(page, statusFilter)}
            />
        </div>
    );
}

function UserRow({ user, isLastRow, onResend, onCancel, onDeactivate, onReactivate }) {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef(null);

    const initials = `${user.first_name?.[0] || ""}${user.last_name?.[0] || ""}`.toUpperCase() || "U";

    // Close menu on outside click
    useEffect(() => {
        function handleClickOutside(e) {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setMenuOpen(false);
            }
        }
        if (menuOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [menuOpen]);

    const isExpired = user.expiry_date && new Date(user.expiry_date) < new Date();
    const statusToDisplay = isExpired && user.status === "active" ? "expired" : user.status;

    return (
        <tr className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
            {/* User Info */}
            <td className="px-3 md:px-6 py-4">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-slate-800 text-white text-xs font-bold flex items-center justify-center shrink-0">
                        {initials}
                    </div>
                    <div>
                        <div className="text-sm font-semibold text-slate-800">
                            {user.first_name} {user.last_name}
                        </div>
                        <div className="text-xs text-slate-400">{user.email}</div>
                    </div>
                </div>
            </td>

            {/* Role */}
            <td className="px-3 md:px-6 py-4">
                <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        user.role === "admin"
                            ? "bg-primary-50 text-primary-700 border border-primary-200/50"
                            : "bg-slate-100 text-slate-600"
                    }`}
                >
                    {user.role === "admin" ? <Shield size={11} /> : null}
                    {user.role === "admin" ? "Admin" : "Staff"}
                </span>
            </td>

            {/* Status */}
            <td className="px-3 md:px-6 py-4">
                <StatusBadge status={statusToDisplay} />
            </td>

            {/* Expiry — hidden on mobile, shown sm+ (matches the header) */}
            <td className="px-3 md:px-6 py-4 text-xs font-medium hidden sm:table-cell">
                {user.expiry_date ? (
                    <span className={isExpired ? "text-rose-600 font-semibold" : "text-slate-600"}>
                        {new Date(user.expiry_date).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                        })}
                        {isExpired ? " (Expired)" : ""}
                    </span>
                ) : (
                    <span className="text-slate-400 font-normal">Never</span>
                )}
            </td>

            {/* Actions Menu */}
            <td className="px-3 md:px-6 py-4 text-right relative">
                <div className="inline-block text-left" ref={menuRef}>
                    <button
                        onClick={() => setMenuOpen(!menuOpen)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                        <MoreHorizontal size={16} />
                    </button>

                    {menuOpen && (
                        <div
                            className={`absolute right-6 ${
                                isLastRow ? "bottom-full mb-1" : "top-full mt-1"
                            } w-44 rounded-xl bg-white shadow-xl border border-slate-100 py-1.5 z-30 animate-scale-in`}
                        >
                            {user.status === "pending" && (
                                <>
                                    <button
                                        onClick={() => {
                                            setMenuOpen(false);
                                            onResend();
                                        }}
                                        className="w-full flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors text-left cursor-pointer"
                                    >
                                        <Mail size={14} className="text-slate-400" />
                                        Resend Invitation
                                    </button>
                                    <button
                                        onClick={() => {
                                            setMenuOpen(false);
                                            onCancel();
                                        }}
                                        className="w-full flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 transition-colors text-left cursor-pointer"
                                    >
                                        <Trash2 size={14} />
                                        Cancel Invitation
                                    </button>
                                </>
                            )}

                            {user.status === "active" && !isExpired && (
                                <button
                                    onClick={() => {
                                        setMenuOpen(false);
                                        onDeactivate();
                                    }}
                                    className="w-full flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 transition-colors text-left cursor-pointer"
                                >
                                    <UserX size={14} />
                                    Deactivate User
                                </button>
                            )}

                            {(user.status === "deactivated" || isExpired) && (
                                <button
                                    onClick={() => {
                                        setMenuOpen(false);
                                        onReactivate();
                                    }}
                                    className="w-full flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-50 transition-colors text-left cursor-pointer"
                                >
                                    <UserCheck size={14} />
                                    Reactivate User
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </td>
        </tr>
    );
}
