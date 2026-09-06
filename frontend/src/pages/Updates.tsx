import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { UpdatesFeed } from "../lib/types";
import { formatDate } from "../lib/format";
import { Alert, Card, EmptyState, SectionHeading, Spinner } from "../components/ui";

export default function Updates() {
  const { user } = useAuth();
  const [feed, setFeed] = useState<UpdatesFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    api.updates()
      .then(setFeed)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load updates"));
  }, []);

  async function refresh() {
    setRefreshing(true);
    try {
      setFeed(await api.adminRefreshUpdates());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!feed) return <Spinner label="Loading the latest from Anthropic" />;

  return (
    <div className="space-y-6 animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">What&apos;s new from Anthropic</h1>
          <p className="page-sub">
            The latest release and engineering videos from Anthropic&apos;s own YouTube channel —
            not exam content, just a way to keep up while you study.
          </p>
        </div>
        {user?.role === "admin" && feed.configured && (
          <button type="button" className="btn-ghost btn-sm" disabled={refreshing} onClick={refresh}>
            {refreshing ? "Refreshing…" : "Refresh now"}
          </button>
        )}
      </div>

      {!feed.configured && (
        <EmptyState
          icon="▶"
          title="Video updates aren't set up yet"
          body="An administrator needs to add a YouTube Data API key (CCARF_YOUTUBE_API_KEY) before this section can fetch anything."
        />
      )}

      {feed.configured && feed.error && feed.videos.length === 0 && (
        <Alert tone="amber">{feed.error}</Alert>
      )}

      {feed.configured && feed.videos.length === 0 && !feed.error && (
        <EmptyState icon="▶" title="No videos yet" body="Nothing has come back from the channel yet — check back shortly." />
      )}

      {feed.videos.length > 0 && (
        <>
          <SectionHeading
            title={`${feed.videos.length} recent video${feed.videos.length === 1 ? "" : "s"}`}
            hint={feed.fetched_at ? `Last refreshed ${formatDate(feed.fetched_at)}` : undefined}
            action={
              <a href={feed.source} target="_blank" rel="noreferrer noopener" className="link text-xs">
                View the channel ↗
              </a>
            }
          />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {feed.videos.map((video) => (
              <Card key={video.video_id} className="flex flex-col overflow-hidden p-0">
                <a href={video.url} target="_blank" rel="noreferrer noopener" className="block">
                  {video.thumbnail_url && (
                    <img src={video.thumbnail_url} alt="" className="aspect-video w-full object-cover" />
                  )}
                </a>
                <div className="flex flex-1 flex-col p-4">
                  <a href={video.url} target="_blank" rel="noreferrer noopener" className="link">
                    <h3 className="line-clamp-2 text-sm font-semibold text-white">{video.title}</h3>
                  </a>
                  <p className="mt-1 text-xs text-ink-500">
                    {video.channel_title} · {formatDate(video.published_at)}
                  </p>
                  <p className="mt-3 line-clamp-3 flex-1 text-[13px] leading-relaxed text-ink-300">
                    {video.description || "No description provided."}
                  </p>
                  <a href={video.url} target="_blank" rel="noreferrer noopener"
                     className="btn-ghost btn-sm mt-4 self-start">
                    Watch on YouTube ↗
                  </a>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
