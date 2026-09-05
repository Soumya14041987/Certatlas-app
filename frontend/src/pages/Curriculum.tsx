import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Blueprint, Curriculum } from "../lib/types";
import { Alert, Card, SectionHeading, Spinner } from "../components/ui";

export default function CurriculumPage() {
  const [data, setData] = useState<Curriculum | null>(null);
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.courses(), api.blueprint()])
      .then(([curriculum, bp]) => { setData(curriculum); setBlueprint(bp); })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the curriculum"));
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!data || !blueprint) return <Spinner label="Loading the curriculum" />;

  const byId = new Map(data.courses.map((course) => [course.id, course]));
  const totalHours = data.courses.reduce((sum, course) => sum + course.est_hours, 0);
  const certificationPage = data.catalogs.find((c) => c.name.toLowerCase().includes("certification page"));

  return (
    <div className="space-y-8 animate-rise">
      <div>
        <h1 className="page-title">Curriculum & study plan</h1>
        <p className="page-sub">
          Which Claude courses map to which exam domain, and the order to work through them.
          Roughly {totalHours} hours of source material across {data.courses.length} resources.
        </p>
      </div>

      <Card className="border-amber-500/25 bg-amber-500/[0.06] p-5">
        <p className="text-sm leading-relaxed text-ink-200">
          <strong className="text-amber-500">Enrolment is on you.</strong> {data.note}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {data.catalogs.map((catalog) => (
            <a key={catalog.url} href={catalog.url} target="_blank" rel="noreferrer noopener"
               className="btn-ghost btn-sm">
              {catalog.name} ↗
            </a>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <SectionHeading title="Register & schedule your exam" />
        <p className="max-w-2xl text-sm leading-relaxed text-ink-300">{data.exam_logistics.scheduling_note}</p>

        <dl className="mt-5 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="stat-label">Question format</dt>
            <dd className="mt-1 text-sm text-ink-200">{data.exam_logistics.question_types}</dd>
          </div>
          <div>
            <dt className="stat-label">Passing score</dt>
            <dd className="mt-1 text-sm text-ink-200">{data.exam_logistics.passing_score}</dd>
          </div>
          <div>
            <dt className="stat-label">Delivery</dt>
            <dd className="mt-1 text-sm text-ink-200">{data.exam_logistics.delivery.join(" or ")}</dd>
          </div>
        </dl>

        {certificationPage && (
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-white/[0.07] pt-6">
            <a href={certificationPage.url} target="_blank" rel="noreferrer noopener" className="btn-primary">
              Register for the exam ↗
            </a>
            <span className="text-xs text-ink-500">
              Opens Anthropic&apos;s own certification page — this app has no scheduling of its own and
              cannot see or affect your registration there.
            </span>
          </div>
        )}
      </Card>

      <section>
        <SectionHeading title="Six-week plan" hint="Each week pairs source material with a measurable target" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.study_plan.map((week) => (
            <Card key={week.week} className="p-5">
              <div className="flex items-center justify-between">
                <span className="chip-brand">Week {week.week}</span>
                <span className="font-mono text-[11px] text-ink-500">{week.focus}</span>
              </div>
              <ul className="mt-4 space-y-1.5">
                {week.courses.length === 0 ? (
                  <li className="text-[13px] text-ink-400">No new material — consolidate.</li>
                ) : (
                  week.courses.map((courseId) => (
                    <li key={courseId} className="flex items-start gap-2 text-[13px] text-ink-200">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-400" />
                      {byId.get(courseId)?.title ?? courseId}
                    </li>
                  ))
                )}
              </ul>
              <p className="mt-4 border-t border-white/[0.06] pt-3 text-xs text-ink-400">
                <span className="font-semibold text-ink-300">Target: </span>{week.target}
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading title="Course map" hint="Every resource, and the domains it feeds" />
        <div className="space-y-3">
          {data.courses.map((course) => (
            <Card key={course.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 grow">
                  <div className="flex flex-wrap items-center gap-2">
                    {course.domains.map((code) => (
                      <span key={code} className="chip-brand font-mono">{code}</span>
                    ))}
                    <span className="chip-neutral">{course.format}</span>
                    <span className="chip-neutral">~{course.est_hours}h</span>
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-white">{course.title}</h3>
                  <p className="mt-0.5 text-xs text-ink-500">{course.provider}</p>
                  <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-300">{course.why}</p>
                </div>
                <a href={course.url} target="_blank" rel="noreferrer noopener" className="btn-ghost btn-sm shrink-0">
                  {course.link_kind === "direct" ? "Open ↗" : "Find in catalogue ↗"}
                </a>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading title="Domain objectives" hint="What each domain expects you to be able to do" />
        <div className="grid gap-3 lg:grid-cols-2">
          {blueprint.domains.map((domain) => (
            <Card key={domain.code} className="p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold text-white">
                  <span className="mr-2 font-mono text-[11px] text-ink-500">{domain.code}</span>
                  {domain.name}
                </h3>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-brand-300">
                  {domain.weight_percent}%
                </span>
              </div>
              <ul className="mt-3.5 space-y-1.5">
                {domain.objectives.map((objective) => (
                  <li key={objective} className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-300">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-500" />
                    {objective}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
