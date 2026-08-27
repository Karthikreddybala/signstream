import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

const AppShell = lazy(() => import("./components/layout/AppShell"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const ApiStatusPage = lazy(() => import("./pages/ApiStatusPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const TranslatePage = lazy(() => import("./pages/TranslatePage"));
const WorkflowPage = lazy(() => import("./pages/WorkflowPage"));

function App() {
    return (
        <Suspense fallback={<div className="page-loading"><span className="loading-orb"><span className="sparkle-mark">✦</span></span><strong>Opening SignStream…</strong></div>}>
            <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={<AuthPage />} />
                <Route path="/register" element={<AuthPage registerMode />} />
                <Route element={<AppShell />}>
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/translate" element={<TranslatePage />} />
                    <Route path="/speech" element={<WorkflowPage kind="speech" />} />
                    <Route path="/documents" element={<WorkflowPage kind="document" />} />
                    <Route path="/images" element={<WorkflowPage kind="image" />} />
                    <Route path="/history" element={<HistoryPage />} />
                    <Route path="/saved" element={<HistoryPage savedOnly />} />
                    <Route path="/status" element={<ApiStatusPage />} />
                    <Route path="/profile" element={<SettingsPage profile />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/help" element={<WorkflowPage kind="help" />} />
                </Route>
                <Route path="/app" element={<Navigate to="/dashboard" replace />} />
                <Route path="*" element={<NotFoundPage />} />
            </Routes>
        </Suspense>
    );
}

export default App;
