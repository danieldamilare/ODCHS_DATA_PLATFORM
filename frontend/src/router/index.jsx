import { BrowserRouter, Routes, Route } from "react-router-dom";
import MainLayout from "../layouts/MainLayout";
import Dashboard from "../pages/Dashboard";
import Enrollment from "../pages/Enrollment";
import BatchDetails from "../pages/BatchDetails";
import FormReview from "../pages/FormReview";

export default function Router() {
    return (
        <BrowserRouter>
            <Routes>
                <Route element={<MainLayout />}>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/enrollment" element={<Enrollment />} />
                    <Route path="/enrollment/batches/:batchId" element={<BatchDetails />} />
                </Route>
                {/* Review page — full screen, no sidebar */}
                <Route path="/enrollment/form/:formId" element={<FormReview />} />
                <Route path="/enrollment/batches/:batchId/review" element={<FormReview />} />
            </Routes>
        </BrowserRouter>
    );
}
