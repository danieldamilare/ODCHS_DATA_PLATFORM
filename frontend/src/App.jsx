import Router from "./router";
import { ToastProvider } from "./components/ui/Toast";

export default function App() {
    return (
        <ToastProvider>
            <Router />
        </ToastProvider>
    );
}
