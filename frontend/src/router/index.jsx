import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import MainLayout from "../layouts/MainLayout";
import ProtectedRoute from "../components/common/ProtectedRoute";

import Login from "../pages/Login";
import ActivateAccount from "../pages/ActivateAccount";
import ResetPassword from "../pages/ResetPassword";

import Dashboard from "../pages/Dashboard";
import Enrollment from "../pages/Enrollment";
import BatchDetails from "../pages/BatchDetails";
import FormReview from "../pages/FormReview";
import IdCardJob from "../pages/IdCardJob";
import NinValidation from "../pages/NinValidation";
import Encounter from "../pages/Encounter";
import AdminUsers from "../pages/AdminUsers";

export default function Router() {
    return (
        <BrowserRouter>
            <Routes>
                {/* Public Auth Routes */}
                <Route path="/login" element={<Login />} />
                <Route path="/auth/activate" element={<ActivateAccount />} />
                <Route path="/auth/reset-password" element={<ResetPassword />} />

                {/* Protected Application Routes inside MainLayout */}
                <Route
                    element={
                        <ProtectedRoute>
                            <MainLayout />
                        </ProtectedRoute>
                    }
                >
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/enrollment" element={<Enrollment />} />
                    <Route path="/enrollment/batches/:batchId" element={<BatchDetails />} />
                    <Route path="/enrollment/batches/:batchId/idcards" element={<IdCardJob />} />
                    <Route path="/nin" element={<NinValidation />} />
                    <Route path="/nin/batch/:jobId" element={<NinValidation />} />
                    <Route path="/encounter" element={<Encounter />} />
                    <Route path="/encounter/:jobId" element={<Encounter />} />

                    {/* Admin Only Route */}
                    <Route
                        path="/admin/users"
                        element={
                            <ProtectedRoute adminOnly>
                                <AdminUsers />
                            </ProtectedRoute>
                        }
                    />
                </Route>

                {/* Full-screen Review Pages (Protected) */}
                <Route
                    path="/enrollment/form/:formId"
                    element={
                        <ProtectedRoute>
                            <FormReview />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/enrollment/batches/:batchId/review"
                    element={
                        <ProtectedRoute>
                            <FormReview />
                        </ProtectedRoute>
                    }
                />

                {/* Fallback */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}
