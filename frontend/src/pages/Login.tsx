import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
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
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(searchParams.get("error_description"));
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { login, register, loginWithProvider } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const registering = mode === "register";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (registering) {
        const { needsEmailConfirmation } = await register(email.trim(), fullName.trim(), password);
        if (needsEmailConfirmation) {
          setNotice("Check your email for a confirmation link, then sign in.");
          setMode("login");
          return;
        }
      } else {
        await login(email.trim(), password);
      }
      navigate(location.state?.from ?? "/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function onProvider(provider: "google" | "github") {
    setError(null);
    try {
      await loginWithProvider(provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="hidden flex-col justify-between border-r border-white/[0.07] bg-ink-900/40 p-12 lg:flex">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-black text-white">C</span>
          <span className="text-[13px] font-bold tracking-tight text-white">CertAtlas</span>
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

          <div className="mt-8 space-y-3">
            <button type="button" onClick={() => onProvider("google")} className="btn-ghost w-full py-3">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.47a5.54 5.54 0 0 1-2.4 3.64v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82Z" />
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.94-2.91l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.94H1.29v3.1A12 12 0 0 0 12 24Z" />
                <path fill="#FBBC05" d="M5.29 14.3A7.2 7.2 0 0 1 4.91 12c0-.8.14-1.57.38-2.3v-3.1H1.29A12 12 0 0 0 0 12c0 1.94.46 3.77 1.29 5.4l4-3.1Z" />
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.29 6.6l4 3.1C6.23 6.86 8.88 4.75 12 4.75Z" />
              </svg>
              Continue with Google
            </button>
            <button type="button" onClick={() => onProvider("github")} className="btn-ghost w-full py-3">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 .5a12 12 0 0 0-3.79 23.4c.6.11.82-.26.82-.58v-2.03c-3.34.72-4.04-1.6-4.04-1.6-.55-1.38-1.33-1.75-1.33-1.75-1.09-.74.08-.73.08-.73 1.2.09 1.83 1.24 1.83 1.24 1.07 1.82 2.8 1.3 3.49 1 .1-.77.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.02 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.49 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" />
              </svg>
              Continue with GitHub
            </button>
          </div>

          <div className="my-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
            <span className="h-px flex-1 bg-white/10" />
            or
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {error && <Alert>{error}</Alert>}
            {notice && <Alert tone="mint">{notice}</Alert>}

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
