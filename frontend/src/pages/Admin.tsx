import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { User } from "../lib/types";
import { Alert, Card, SectionHeading, Spinner, Stat } from "../components/ui";
import { formatDate } from "../lib/format";

interface Stats {
  users: number; active_users: number; attempts_total: number;
  attempts_submitted: number; attempts_open: number; average_score: number | null;
  content: {
    total_questions: number; cheatsheets: number; courses: number;
    domains: { code: string; name: string; count: number; difficulty: Record<string, number> }[];
  };
}

export default function Admin() {
  const { user: me } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([api.adminStats(), api.adminUsers()])
      .then(([s, u]) => { setStats(s as unknown as Stats); setUsers(u); })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the admin console"));
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!stats || !users) return <Spinner label="Loading the admin console" />;

  async function update(id: number, body: { is_active?: boolean; role?: string }) {
    setPending(id);
    setError(null);
    try {
      const updated = await api.adminUpdateUser(id, body);
      setUsers((prev) => prev!.map((u) => (u.id === id ? updated : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that user");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6 animate-rise">
      <div>
        <h1 className="page-title">Admin console</h1>
        <p className="page-sub">Platform usage and account management. Admin-only, enforced server-side.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Accounts" value={stats.users} sub={`${stats.active_users} active`} />
        <Stat label="Attempts" value={stats.attempts_total} sub={`${stats.attempts_open} still open`} />
        <Stat label="Submitted" value={stats.attempts_submitted} sub="graded papers" />
        <Stat label="Mean score" value={stats.average_score === null ? "—" : `${stats.average_score}%`}
              sub="across all submissions" />
      </div>

      <Card className="p-6">
        <SectionHeading title="Question bank"
                        hint={`${stats.content.total_questions} items · ${stats.content.cheatsheets} cheat sheets · ${stats.content.courses} mapped courses`} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-ink-400">
                <th className="pb-3 text-left font-semibold">Domain</th>
                <th className="pb-3 text-right font-semibold">Items</th>
                <th className="pb-3 text-right font-semibold">Foundational</th>
                <th className="pb-3 text-right font-semibold">Applied</th>
                <th className="pb-3 text-right font-semibold">Architect</th>
              </tr>
            </thead>
            <tbody>
              {stats.content.domains.map((domain) => (
                <tr key={domain.code} className="border-t border-white/[0.05]">
                  <td className="py-3">
                    <span className="mr-2 font-mono text-[11px] text-ink-500">{domain.code}</span>
                    <span className="text-ink-200">{domain.name}</span>
                  </td>
                  <td className="py-3 text-right font-semibold tabular-nums text-white">{domain.count}</td>
                  <td className="py-3 text-right tabular-nums text-ink-400">{domain.difficulty.foundational}</td>
                  <td className="py-3 text-right tabular-nums text-ink-400">{domain.difficulty.applied}</td>
                  <td className="py-3 text-right tabular-nums text-ink-400">{domain.difficulty.architect}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-5 border-t border-white/[0.06] pt-4 text-xs leading-relaxed text-ink-500">
          Content is versioned in the repository under <code className="font-mono text-ink-400">backend/app/content/</code>.
          New batches can be posted to <code className="font-mono text-ink-400">POST /api/v1/admin/content/questions</code>;
          they are validated in full before anything is written. Growing the bank rebalances how future
          practice sets are composed — attempts already created keep their frozen paper.
        </p>
      </Card>

      <Card className="overflow-hidden">
        <div className="p-6 pb-0">
          <SectionHeading title="Accounts" hint="Disabling an account also revokes its live sessions" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-white/[0.03]">
              <tr className="text-[11px] uppercase tracking-wider text-ink-400">
                <th className="px-6 py-3 text-left font-semibold">User</th>
                <th className="px-6 py-3 text-left font-semibold">Role</th>
                <th className="px-6 py-3 text-left font-semibold">Status</th>
                <th className="px-6 py-3 text-left font-semibold">Joined</th>
                <th className="px-6 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const self = user.id === me?.id;
                return (
                  <tr key={user.id} className="border-t border-white/[0.05]">
                    <td className="px-6 py-3.5">
                      <div className="font-medium text-ink-100">
                        {user.full_name} {self && <span className="text-[11px] text-ink-500">(you)</span>}
                      </div>
                      <div className="text-xs text-ink-500">{user.email}</div>
                    </td>
                    <td className="px-6 py-3.5">
                      <span className={user.role === "admin" ? "chip-brand" : "chip-neutral"}>{user.role}</span>
                    </td>
                    <td className="px-6 py-3.5">
                      <span className={user.is_active ? "chip-mint" : "chip-rose"}>
                        {user.is_active ? "active" : "disabled"}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-xs text-ink-400">{formatDate(user.created_at)}</td>
                    <td className="px-6 py-3.5">
                      <div className="flex justify-end gap-2">
                        <button type="button" className="btn-ghost btn-sm" disabled={self || pending === user.id}
                                onClick={() => update(user.id, { role: user.role === "admin" ? "user" : "admin" })}>
                          {user.role === "admin" ? "Demote" : "Make admin"}
                        </button>
                        <button type="button" disabled={self || pending === user.id}
                                className={user.is_active ? "btn-danger btn-sm" : "btn-ghost btn-sm"}
                                onClick={() => update(user.id, { is_active: !user.is_active })}>
                          {user.is_active ? "Disable" : "Enable"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
