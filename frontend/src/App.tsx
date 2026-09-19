import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import Shell from "./components/Shell";
import { useAuth } from "./lib/auth";
import { Spinner } from "./components/ui";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import PracticeSets from "./pages/PracticeSets";
import ExamLobby from "./pages/ExamLobby";
import Diagnostic from "./pages/Diagnostic";
import Runner from "./pages/Runner";
import ScorecardPage from "./pages/Scorecard";
import ReviewPage from "./pages/Review";
import CheatSheets from "./pages/CheatSheets";
import HeuristicsPage from "./pages/Heuristics";
import Curriculum from "./pages/Curriculum";
import History from "./pages/History";
import Updates from "./pages/Updates";
import Profile from "./pages/Profile";
import Admin from "./pages/Admin";

function Protected({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Restoring your session" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (adminOnly && user.role !== "admin") return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  const { user, loading } = useAuth();

  return (
    <Routes>
      <Route path="/" element={loading ? <Spinner /> : user ? <Navigate to="/dashboard" replace /> : <Landing />} />
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to="/dashboard" replace /> : <Login initialMode="register" />} />

      {/* The runner is full-bleed: no shell chrome competing with the paper. */}
      <Route path="/attempt/:id" element={<Protected><Runner /></Protected>} />

      <Route element={<Protected><Shell /></Protected>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/practice" element={<PracticeSets />} />
        <Route path="/exam" element={<ExamLobby />} />
        <Route path="/diagnostic" element={<Diagnostic />} />
        <Route path="/attempt/:id/scorecard" element={<ScorecardPage />} />
        <Route path="/attempt/:id/review" element={<ReviewPage />} />
        <Route path="/cheatsheets" element={<CheatSheets />} />
        <Route path="/cheatsheets/:slug" element={<CheatSheets />} />
        <Route path="/instincts" element={<HeuristicsPage />} />
        <Route path="/curriculum" element={<Curriculum />} />
        <Route path="/updates" element={<Updates />} />
        <Route path="/history" element={<History />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/admin" element={<Protected adminOnly><Admin /></Protected>} />
      </Route>

      <Route path="*" element={<Navigate to={user ? "/dashboard" : "/"} replace />} />
    </Routes>
  );
}
