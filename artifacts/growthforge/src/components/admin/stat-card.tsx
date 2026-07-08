interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  color?: string;
  trend?: { value: number; label: string };
}

export default function StatCard({ label, value, sub, icon, color = "#00E676", trend }: StatCardProps) {
  return (
    <div className="p-5 rounded-2xl border border-white/8 relative overflow-hidden group hover:border-white/15 transition-all"
      style={{ background: "rgba(255,255,255,0.02)" }}>
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none rounded-2xl"
        style={{ background: `radial-gradient(ellipse at top left, ${color}08 0%, transparent 65%)` }} />
      <div className="relative flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-white/40 font-medium uppercase tracking-wider mb-2">{label}</div>
          <div className="text-3xl font-black text-white tabular-nums">{value}</div>
          {sub && <div className="text-xs text-white/30 mt-1">{sub}</div>}
          {trend && (
            <div className={`text-xs font-medium mt-2 flex items-center gap-1 ${trend.value >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {trend.value >= 0 ? "↑" : "↓"} {Math.abs(trend.value)}% {trend.label}
            </div>
          )}
        </div>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `${color}15`, border: `1px solid ${color}25` }}>
          <span style={{ color }}>{icon}</span>
        </div>
      </div>
    </div>
  );
}
