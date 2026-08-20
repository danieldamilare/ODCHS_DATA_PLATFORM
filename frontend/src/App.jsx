import Router from "./router";
import { ToastProvider } from "./components/ui/Toast";
import { AuthProvider } from "./context/AuthContext";

export default function App() {
    return (
        <ToastProvider>
            <AuthProvider>
                <Router />
            </AuthProvider>
        </ToastProvider>
    );
}
