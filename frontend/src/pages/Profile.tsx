import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Alert, Card, SectionHeading, Spinner } from "../components/ui";
import { formatDate, formatDateTime } from "../lib/format";

type Session = { id: number; issued_at: string; expires_at: string; active: boolean; user_agent: string | null };

export default function Profile() {
  const { user, setUser, logout } = useAuth();
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [targetDate, setTargetDate] = useState(user?.target_exam_date?.slice(0, 10) ?? "");
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.sessions().then(setSessions).catch(() => setSessions([])); }, []);

  if (!user) return <Spinner />;

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await api.updateProfile({
        full_name: fullName.trim(),
        target_exam_date: targetDate ? new Date(`${targetDate}T09:00:00Z`).toISOString() : null,
      });
      setUser(updated);
      setMessage("Profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your profile");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6 animate-rise">
      <div>
        <h1 className="page-title">Your account</h1>
        <p className="page-sub">
          Signed in as {user.email} · joined {formatDate(user.created_at)}
        </p>
      </div>

      <Card className="p-6">
        <SectionHeading title="Profile" hint="A target date turns the dashboard into a countdown" />
        {message && <div className="mb-4"><Alert tone="mint">{message}</Alert></div>}
        {error && <div className="mb-4"><Alert>{error}</Alert></div>}
        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="label" htmlFor="full_name">Full name</label>
            <input id="full_name" className="field" value={fullName} minLength={2}
                   onChange={(event) => setFullName(event.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="target">Target exam date</label>
            <input id="target" type="date" className="field" value={targetDate}
                   onChange={(event) => setTargetDate(event.target.value)} />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
            {targetDate && (
              <button type="button" className="btn-quiet" onClick={() => setTargetDate("")}>
                Clear date
              </button>
            )}
          </div>
        </form>
      </Card>

      <Card className="p-6">
        <SectionHeading title="Active sessions"
                        hint="Each sign-in issues a refresh token you can revoke"
                        action={
                          <button type="button" className="btn-danger btn-sm"
                                  onClick={async () => { await api.logoutEverywhere().catch(() => undefined); await logout(); }}>
                            Sign out everywhere
                          </button>
                        } />
        {sessions === null ? (
          <Spinner label="Loading sessions" />
        ) : sessions.length === 0 ? (
          <p className="text-sm text-ink-400">No recorded sessions.</p>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {sessions.map((session) => (
              <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] text-ink-200">
                    {session.user_agent ?? "Unknown client"}
                  </div>
                  <div className="text-xs text-ink-500">
                    Started {formatDateTime(session.issued_at)} · expires {formatDate(session.expires_at)}
                  </div>
                </div>
                <span className={session.active ? "chip-mint" : "chip-neutral"}>
                  {session.active ? "Active" : "Revoked"}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-6">
        <SectionHeading title="Account details" />
        <dl className="grid gap-4 sm:grid-cols-2">
          {[
            ["Email", user.email],
            ["Role", user.role === "admin" ? "Administrator" : "Candidate"],
            ["Last sign-in", formatDateTime(user.last_login_at)],
            ["Status", user.is_active ? "Active" : "Disabled"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="stat-label">{label}</dt>
              <dd className="mt-1 text-sm text-ink-200">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
