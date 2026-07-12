import { useState } from "react";
import { useParams } from "wouter";
import { useListSocialPosts, useListEmails } from "@workspace/api-client-react";
import type { SocialPost, EmailCampaign } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, CalendarDays, Share2, Mail, Loader2 } from "lucide-react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type ScheduledPost = SocialPost & { scheduledAt?: string | null };
type ScheduledEmail = EmailCampaign & { scheduledAt?: string | null };

function buildMonthGrid(year: number, month: number): (Date | null)[][] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const weeks: (Date | null)[][] = [];
  let week: (Date | null)[] = Array.from({ length: firstDay.getDay() }, () => null);

  for (let d = 1; d <= lastDay.getDate(); d++) {
    week.push(new Date(year, month, d));
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

function dateKey(d: Date) {
  return d.toISOString().split("T")[0]!;
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const platformColors: Record<string, string> = {
  facebook:  "bg-blue-500/15 text-blue-400 border-blue-500/20",
  instagram: "bg-pink-500/15 text-pink-400 border-pink-500/20",
  linkedin:  "bg-sky-500/15 text-sky-400 border-sky-500/20",
  x:         "bg-zinc-500/15 text-zinc-300 border-zinc-500/20",
  tiktok:    "bg-purple-500/15 text-purple-400 border-purple-500/20",
};

export default function ProjectCalendar() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const { data: socialPosts, isLoading: postsLoading } = useListSocialPosts(projectId, { query: { enabled: !!projectId } });
  const { data: emails, isLoading: emailsLoading } = useListEmails(projectId, { query: { enabled: !!projectId } });

  const scheduledPosts = ((socialPosts ?? []) as ScheduledPost[]).filter(p => !!p.scheduledAt);
  const scheduledEmails = ((emails ?? []) as ScheduledEmail[]).filter(e => !!e.scheduledAt);

  const totalScheduled = scheduledPosts.length + scheduledEmails.length;
  const isLoading = postsLoading || emailsLoading;

  const weeks = buildMonthGrid(year, month);
  const todayKey = dateKey(now);

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };

  const getItemsForDay = (date: Date) => {
    const key = dateKey(date);
    return {
      posts: scheduledPosts.filter(p => p.scheduledAt!.slice(0, 10) === key),
      mails: scheduledEmails.filter(e => e.scheduledAt!.slice(0, 10) === key),
    };
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Content Calendar</h1>
          <p className="text-muted-foreground mt-1">
            {isLoading ? "Loading…" : totalScheduled === 0
              ? "No scheduled content yet"
              : `${totalScheduled} item${totalScheduled !== 1 ? "s" : ""} scheduled`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-bold min-w-[150px] text-center">{MONTHS[month]} {year}</span>
          <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 mb-5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Share2 className="h-3 w-3 text-primary" />
          <span>Social post</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Mail className="h-3 w-3 text-cyan-400" />
          <span>Email campaign</span>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Calendar grid */}
          <div className="rounded-2xl border border-border overflow-hidden">
            {/* Day headers */}
            <div className="grid grid-cols-7 bg-secondary/40 border-b border-border">
              {DAYS.map(d => (
                <div key={d} className="text-center text-[11px] font-bold text-muted-foreground py-2.5 tracking-wider">
                  {d}
                </div>
              ))}
            </div>

            {/* Weeks */}
            {weeks.map((week, wi) => (
              <div key={wi} className={`grid grid-cols-7 ${wi < weeks.length - 1 ? "border-b border-border" : ""}`}>
                {week.map((date, di) => {
                  const isToday = date ? dateKey(date) === todayKey : false;
                  const { posts, mails } = date ? getItemsForDay(date) : { posts: [], mails: [] };
                  const total = posts.length + mails.length;
                  const MAX_VISIBLE = 3;

                  return (
                    <div
                      key={di}
                      className={`min-h-[88px] p-1.5 ${di < 6 ? "border-r border-border" : ""} ${!date ? "bg-secondary/10" : "bg-card"} transition-colors`}
                    >
                      {date && (
                        <>
                          <div className={`text-[11px] font-bold w-6 h-6 flex items-center justify-center rounded-full mb-1.5 ${
                            isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                          }`}>
                            {date.getDate()}
                          </div>

                          <div className="space-y-0.5">
                            {posts.slice(0, MAX_VISIBLE).map(p => {
                              const itemId = `post-${p.id}`;
                              const colorClass = platformColors[p.platform.toLowerCase()] ?? "bg-primary/15 text-primary border-primary/20";
                              return (
                                <div
                                  key={p.id}
                                  className="relative"
                                  onMouseEnter={() => setHoveredItem(itemId)}
                                  onMouseLeave={() => setHoveredItem(null)}
                                >
                                  <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded border ${colorClass} cursor-default`}>
                                    <Share2 className="h-2.5 w-2.5 shrink-0" />
                                    <span className="text-[10px] truncate">{p.platform}</span>
                                  </div>
                                  {hoveredItem === itemId && (
                                    <div className="absolute bottom-full left-0 z-50 mb-1 w-52 bg-card border border-border rounded-xl p-3 shadow-xl pointer-events-none">
                                      <p className="text-[10px] font-bold mb-1 capitalize">{p.platform} · {timeLabel(p.scheduledAt!)}</p>
                                      <p className="text-[10px] text-muted-foreground line-clamp-3">{p.caption}</p>
                                    </div>
                                  )}
                                </div>
                              );
                            })}

                            {mails.slice(0, MAX_VISIBLE - Math.min(posts.length, MAX_VISIBLE)).map(e => {
                              const itemId = `email-${e.id}`;
                              return (
                                <div
                                  key={e.id}
                                  className="relative"
                                  onMouseEnter={() => setHoveredItem(itemId)}
                                  onMouseLeave={() => setHoveredItem(null)}
                                >
                                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border bg-cyan-500/15 border-cyan-500/20 text-cyan-400 cursor-default">
                                    <Mail className="h-2.5 w-2.5 shrink-0" />
                                    <span className="text-[10px] truncate">{e.subject.slice(0, 14)}</span>
                                  </div>
                                  {hoveredItem === itemId && (
                                    <div className="absolute bottom-full left-0 z-50 mb-1 w-52 bg-card border border-border rounded-xl p-3 shadow-xl pointer-events-none">
                                      <p className="text-[10px] font-bold mb-1 text-cyan-400">Email · {timeLabel(e.scheduledAt!)}</p>
                                      <p className="text-[10px] text-muted-foreground line-clamp-2">{e.subject}</p>
                                    </div>
                                  )}
                                </div>
                              );
                            })}

                            {total > MAX_VISIBLE && (
                              <div className="text-[10px] text-muted-foreground px-1.5">
                                +{total - MAX_VISIBLE} more
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Empty state */}
          {totalScheduled === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-10 flex flex-col items-center text-center"
            >
              <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                <CalendarDays className="h-8 w-8 text-primary/50" />
              </div>
              <h2 className="text-xl font-bold mb-2">Nothing scheduled yet</h2>
              <p className="text-sm text-muted-foreground max-w-sm">
                Schedule posts from{" "}
                <a href="../social" className="text-primary hover:underline">Social Media</a>
                {" "}or emails from{" "}
                <a href="../email" className="text-primary hover:underline">Email Marketing</a>
                {" "}and they'll appear here.
              </p>
            </motion.div>
          )}

          {/* Upcoming list */}
          {totalScheduled > 0 && (
            <div className="mt-8">
              <h2 className="text-base font-black mb-4">Upcoming This Month</h2>
              <div className="space-y-2">
                {[
                  ...scheduledPosts
                    .filter(p => {
                      const d = new Date(p.scheduledAt!);
                      return d.getFullYear() === year && d.getMonth() === month;
                    })
                    .map(p => ({ type: "post" as const, date: new Date(p.scheduledAt!), data: p })),
                  ...scheduledEmails
                    .filter(e => {
                      const d = new Date(e.scheduledAt!);
                      return d.getFullYear() === year && d.getMonth() === month;
                    })
                    .map(e => ({ type: "email" as const, date: new Date(e.scheduledAt!), data: e })),
                ]
                  .sort((a, b) => a.date.getTime() - b.date.getTime())
                  .slice(0, 10)
                  .map((item, i) => (
                    <motion.div
                      key={`${item.type}-${item.data.id}`}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border"
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${item.type === "post" ? "bg-primary/10" : "bg-cyan-500/10"}`}>
                        {item.type === "post"
                          ? <Share2 className="h-4 w-4 text-primary" />
                          : <Mail className="h-4 w-4 text-cyan-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold truncate">
                          {item.type === "post"
                            ? `${(item.data as ScheduledPost).platform} post`
                            : (item.data as ScheduledEmail).subject}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {item.date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                          {" at "}
                          {item.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      {item.type === "post" && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${platformColors[(item.data as ScheduledPost).platform.toLowerCase()] ?? "bg-primary/10 text-primary border-primary/20"}`}>
                          {(item.data as ScheduledPost).platform}
                        </span>
                      )}
                      {item.type === "email" && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-cyan-500/10 text-cyan-400 border-cyan-500/20">
                          email
                        </span>
                      )}
                    </motion.div>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
