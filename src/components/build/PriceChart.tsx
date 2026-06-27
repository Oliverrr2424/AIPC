"use client";
import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from "recharts";
import { TrendDown, TrendUp } from "@phosphor-icons/react";

interface PricePoint { date: string; priceUsd: number; retailer: string; inStock: boolean; }
interface PriceStats {
  current: number | null;
  min30d: number | null;
  max30d: number | null;
  avg30d: number | null;
  change30d: number | null;
  history: PricePoint[];
}

export function PriceChart({ partId, partName }: { partId: string; partName?: string }) {
  const [data, setData] = useState<PriceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/parts/${partId}`)
      .then(r => r.json())
      .then((d: { price?: PriceStats }) => { if (!cancelled) setData(d.price ?? null); })
      .catch(() => { if (!cancelled) setError("Unable to load price history."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [partId]);

  const chartData = useMemo(() => {
    if (!data) return [];
    // One series per retailer; merge on date.
    const byDate = new Map<string, { date: string; [retailer: string]: number | string }>();
    for (const pt of data.history) {
      const row = byDate.get(pt.date) ?? { date: pt.date };
      row[pt.retailer] = pt.priceUsd;
      byDate.set(pt.date, row);
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  const retailers = useMemo(() => {
    if (!data) return ["list"] as string[];
    return Array.from(new Set(data.history.map(h => h.retailer)));
  }, [data]);

  if (loading) return <div className="surface rounded-2xl p-6 animate-pulse"><div className="h-4 w-24 bg-[var(--panel-2)] rounded" /></div>;
  if (error || !data) return <div className="surface rounded-2xl p-6 text-sm text-[var(--muted)]">{error ?? "No price data yet."}</div>;

  const up = (data.change30d ?? 0) >= 0;
  const TrendIcon = up ? TrendUp : TrendDown;
  const trendColor = up ? "text-[var(--danger)]" : "text-[var(--success)]";

  return (
    <section className="surface rounded-2xl p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Price history</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {partName ? `${partName} · ` : ""}North American market · USD
          </p>
        </div>
        {data.current != null && (
          <div className="text-right">
            <div className="text-2xl font-semibold mono">${data.current.toFixed(2)}</div>
            {data.change30d != null && (
              <div className={`mt-1 inline-flex items-center gap-1 text-xs ${trendColor}`}>
                <TrendIcon size={14} weight="fill" />
                {up ? "+" : ""}{data.change30d}% (30d)
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <Stat label="30d low" value={data.min30d != null ? `$${data.min30d.toFixed(2)}` : "—"} />
        <Stat label="30d avg" value={data.avg30d != null ? `$${data.avg30d.toFixed(2)}` : "—"} />
        <Stat label="30d high" value={data.max30d != null ? `$${data.max30d.toFixed(2)}` : "—"} />
      </div>

      <div className="mt-4 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "var(--muted)", fontSize: 10 }} minTickGap={28} />
            <YAxis tick={{ fill: "var(--muted)", fontSize: 10 }} domain={["auto", "auto"]} width={48} tickFormatter={(v: number) => `$${v}`} />
            <Tooltip
              contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, fontSize: 12 }}
              formatter={(v: number) => [`$${v.toFixed(2)}`, "Price"]}
            />
            {data.avg30d != null && <ReferenceLine y={data.avg30d} stroke="var(--muted)" strokeDasharray="4 4" label={{ value: "avg", fill: "var(--muted)", fontSize: 10, position: "insideTopRight" }} />}
            {retailers.map((r, i) => (
              <Line key={r} type="monotone" dataKey={r} stroke={i === 0 ? "var(--accent)" : "var(--muted)"} strokeWidth={2} dot={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-[var(--muted)]">
        {retailers.map(r => <span key={r} className="mono">● {r}</span>)}
        <span>· last sync: {data.history.at(-1)?.date ?? "—"}</span>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--panel-2)] p-3">
      <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mono mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}
