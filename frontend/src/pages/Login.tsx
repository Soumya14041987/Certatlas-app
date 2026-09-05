import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Alert } from "../components/ui";

const RULES = [
  { test: (p: string) => p.length >= 10, label: "10+ characters" },
  { test: (p: string) => /[a-z]/.test(p), label: "lowercase" },
  { test: (p: string) => /[A-Z]/.test(p), label: "uppercase" },
  { test: (p: string) => /[0-9]/.test(p), label: "digit" },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), label: "symbol" },
];

export default function Login({ initialMode = "login" }: { initialMode?: "login" | "register" }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const registering = mode === "register";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (registering) await register(email.trim(), fullName.trim(), password);
      else await login(email.trim(), password);
      navigate(location.state?.from ?? "/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="hidden flex-col justify-between border-r border-white/[0.07] bg-ink-900/40 p-12 lg:flex">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-black text-white">C</span>
          <span className="text-[13px] font-bold tracking-tight text-white">CCAR-F Prep</span>
        </Link>
        <div className="max-w-md">
          <h2 className="text-3xl font-bold leading-tight tracking-tight text-white">
            Every wrong answer becomes a lesson you actually remember.
          </h2>
          <p className="mt-5 text-sm leading-relaxed text-ink-400">
            Miss a question and you get more than a red cross: the reasoning, why each
            distractor is wrong, an analogy from systems you already know, a working
            snippet, and the cheat-sheet section that covers it — inline, without
            leaving the review.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-ink-300">
            {[
              "300 blueprint-weighted practice sets",
              "Pause and resume without losing the clock",
              "Timed 60-question mock exams",
              "Per-domain readiness and a projected score",
            ].map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span className="mt-0.5 text-mint-400">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[11px] leading-relaxed text-ink-500">
          Community-authored study material. Not affiliated with or endorsed by Anthropic.
        </p>
      </aside>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm animate-rise">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {registering ? "Create your account" : "Welcome back"}
          </h1>
          <p className="page-sub">
            {registering ? "Free, and your progress is saved as you go." : "Pick up where you left off."}
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
            {error && <Alert>{error}</Alert>}

            {registering && (
              <div>
                <label className="label" htmlFor="name">Full name</label>
                <input id="name" className="field" value={fullName} required minLength={2}
                       autoComplete="name" onChange={(e) => setFullName(e.target.value)} />
              </div>
            )}

            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" className="field" value={email} required
                     autoComplete="email" placeholder="you@example.com"
                     onChange={(e) => setEmail(e.target.value)} />
            </div>

            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" type="password" className="field" value={password} required
                     autoComplete={registering ? "new-password" : "current-password"}
                     onChange={(e) => setPassword(e.target.value)} />
              {registering && (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {RULES.map((rule) => {
                    const ok = rule.test(password);
                    return (
                      <li key={rule.label}
                          className={`chip ${ok ? "chip-mint" : "border-white/10 bg-white/[0.03] text-ink-500"}`}>
                        {ok ? "✓" : "•"} {rule.label}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <button type="submit" className="btn-primary w-full py-3" disabled={busy}>
              {busy ? "Working…" : registering ? "Create account" : "Sign in"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-ink-400">
            {registering ? "Already registered?" : "New here?"}{" "}
            <button type="button" className="link font-medium"
                    onClick={() => { setMode(registering ? "login" : "register"); setError(null); }}>
              {registering ? "Sign in" : "Create an account"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
