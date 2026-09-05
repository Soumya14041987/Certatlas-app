import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Alert, Card, SectionHeading, Spinner } from "./ui";
import type { AdminQuestion } from "../lib/types";

const DOMAINS = ["AAO", "TDM", "CCW", "PES", "CMR"];

/** Accepts a pasted single question object, a bare array, or {"questions":[...]}. */
function normaliseImportPayload(raw: string): { name?: string; questions: Record<string, unknown>[] } {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return { questions: parsed };
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.questions)) {
    return { name: typeof parsed.name === "string" ? parsed.name : undefined, questions: parsed.questions };
  }
  if (parsed && typeof parsed === "object" && "id" in parsed) return { questions: [parsed] };
  throw new Error("Paste a single question object, an array of questions, or {\"questions\": [...]}");
}

function ImportPanel({ onImported }: { onImported: () => void }) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadTemplate() {
    setError(null);
    try {
      const { template } = await api.adminQuestionTemplate();
      setText(JSON.stringify(template, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the template");
    }
  }

  async function submit() {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const { questions } = normaliseImportPayload(text);
      if (questions.length === 0) throw new Error("No questions found in the pasted content.");
      const batchName = name.trim() || `admin-import-${Date.now()}`;
      const response = await api.adminImportQuestions(batchName, questions);
      setResult(`Imported ${response.imported} question(s) into ${response.file}.`);
      setText("");
      setName("");
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <SectionHeading title="Add questions"
                      hint="Paste one question, an array, or {questions:[...]} — validated in full before anything is written" />
      {result && <div className="mb-4"><Alert tone="mint">{result}</Alert></div>}
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className="field w-64" placeholder="Batch name (optional)" value={name}
               onChange={(e) => setName(e.target.value)} />
        <button type="button" className="btn-ghost btn-sm" onClick={loadTemplate}>
          Copy a blank template in
        </button>
      </div>

      <textarea
        className="field h-64 font-mono text-[12.5px] leading-relaxed"
        placeholder='{"id": "AAO-201", "domain": "AAO", "difficulty": "applied", "type": "single", "stem": "...", "options": [...], "correct": ["A"], "explanation": "...", "distractor_notes": {...}}'
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />

      <button type="button" className="btn-primary mt-4" disabled={busy || !text.trim()} onClick={submit}>
        {busy ? "Validating…" : "Validate & import"}
      </button>
    </Card>
  );
}

function EditModal({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.adminGetQuestion(id)
      .then((question) => {
        const { source_file: _drop, ...editable } = question;
        setText(JSON.stringify(editable, null, 2));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load that question"))
      .finally(() => setLoading(false));
  }, [id]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const parsed = JSON.parse(text);
      await api.adminUpdateQuestion(id, parsed);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm"
         role="dialog" aria-modal="true">
      <Card raised className="flex max-h-[85vh] w-full max-w-2xl flex-col p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Edit {id}</h2>
          <button type="button" className="btn-quiet btn-sm" onClick={onClose}>Close</button>
        </div>

        {loading ? (
          <Spinner label="Loading" />
        ) : (
          <>
            {error && <div className="mb-3"><Alert>{error}</Alert></div>}
            <textarea
              className="field grow font-mono text-[12.5px] leading-relaxed"
              style={{ minHeight: "50vh" }}
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
            />
            <div className="mt-4 flex gap-2">
              <button type="button" className="btn-primary grow" disabled={busy} onClick={save}>
                {busy ? "Saving…" : "Save changes"}
              </button>
              <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

export default function AdminQuestionManager() {
  const [domain, setDomain] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ pages: number; total: number; items: AdminQuestion[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function reload() {
    api.adminListQuestions({ domain: domain || undefined, search: search || undefined, page, per_page: 20 })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load questions"));
  }

  useEffect(reload, [domain, search, page]);

  async function remove(id: string) {
    if (!window.confirm(`Permanently delete ${id}? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await api.adminDeleteQuestion(id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <ImportPanel onImported={reload} />

      <Card className="p-6">
        <SectionHeading title="Browse & edit" hint={data ? `${data.total} questions in the bank` : undefined} />

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select className="field w-auto py-2" value={domain}
                  onChange={(e) => { setDomain(e.target.value); setPage(1); }}>
            <option value="">All domains</option>
            {DOMAINS.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
          <input className="field w-64" placeholder="Search id or stem…" value={search}
                 onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>

        {error && <div className="mb-4"><Alert>{error}</Alert></div>}

        {!data ? (
          <Spinner label="Loading questions" />
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-white/[0.07]">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-white/[0.03]">
                  <tr className="text-[11px] uppercase tracking-wider text-ink-400">
                    <th className="px-4 py-2.5 text-left font-semibold">ID</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Domain</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Stem</th>
                    <th className="px-4 py-2.5 text-left font-semibold">File</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((q) => (
                    <tr key={q.id} className="border-t border-white/[0.05]">
                      <td className="px-4 py-3 font-mono text-[12px] text-ink-300">{q.id}</td>
                      <td className="px-4 py-3"><span className="chip-brand font-mono">{q.domain}</span></td>
                      <td className="max-w-md truncate px-4 py-3 text-ink-200">{q.stem}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-ink-500">{q.source_file}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingId(q.id)}>
                            Edit
                          </button>
                          <button type="button" className="btn-danger btn-sm" disabled={deletingId === q.id}
                                  onClick={() => remove(q.id)}>
                            {deletingId === q.id ? "…" : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-center gap-3">
              <button type="button" className="btn-ghost btn-sm" disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}>← Previous</button>
              <span className="text-xs text-ink-500">Page {page} of {data.pages}</span>
              <button type="button" className="btn-ghost btn-sm" disabled={page >= data.pages}
                      onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
          </>
        )}
      </Card>

      {editingId && (
        <EditModal id={editingId} onClose={() => setEditingId(null)} onSaved={reload} />
      )}
    </>
  );
}
