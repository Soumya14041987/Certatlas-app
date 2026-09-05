import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: "◎" },
  { to: "/practice", label: "Practice", icon: "▤" },
  { to: "/exam", label: "Exam", icon: "◈" },
  { to: "/cheatsheets", label: "Cheat sheets", icon: "❑" },
  { to: "/curriculum", label: "Curriculum", icon: "◧" },
  { to: "/history", label: "History", icon: "◷" },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-black text-white">
        C
      </span>
      <div className="leading-tight">
        <div className="text-[13px] font-bold tracking-tight text-white">CCAR-F Prep</div>
        <div className="text-[10px] uppercase tracking-[0.16em] text-ink-500">
          Architect Foundations
        </div>
      </div>
    </div>
  );
}

export default function Shell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const links = user?.role === "admin" ? [...NAV, { to: "/admin", label: "Admin", icon: "⚙" }] : NAV;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-ink-950/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <NavLink to="/dashboard" className="shrink-0"><Brand /></NavLink>

          <nav className="hidden flex-1 items-center gap-1 lg:flex">
            {links.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                    isActive ? "bg-white/[0.07] text-white" : "text-ink-300 hover:bg-white/[0.04] hover:text-white"
                  }`
                }
              >
                <span className="mr-2 text-ink-500">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <NavLink to="/profile" className="hidden text-right sm:block">
              <div className="text-[13px] font-medium text-white">{user?.full_name}</div>
              <div className="text-[11px] text-ink-500">
                {user?.role === "admin" ? "Administrator" : "Candidate"}
              </div>
            </NavLink>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={async () => { await logout(); navigate("/login"); }}
            >
              Sign out
            </button>
            <button
              type="button"
              aria-label="Toggle navigation"
              aria-expanded={menuOpen}
              className="btn btn-ghost btn-sm lg:hidden"
              onClick={() => setMenuOpen((open) => !open)}
            >
              ☰
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="border-t border-white/[0.07] px-4 py-3 lg:hidden">
            <div className="grid grid-cols-2 gap-1.5">
              {links.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-2.5 text-sm ${
                      isActive ? "bg-white/[0.07] text-white" : "text-ink-300"
                    }`
                  }
                >
                  <span className="mr-2 text-ink-500">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <Outlet />
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-10 pt-4 sm:px-6">
        <p className="border-t border-white/[0.05] pt-5 text-[11px] leading-relaxed text-ink-500">
          Community-authored study material for the CCAR-F blueprint. Not affiliated with,
          endorsed by, or sourced from Anthropic. Contains no real certification questions —
          every item is original practice content written against the published course topics.
        </p>
      </footer>
    </div>
  );
}
