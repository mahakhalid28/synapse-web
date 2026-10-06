import { useState, useEffect } from "react";
import Sidebar from "./Sidebar";
import { getInterventionPoints } from "../api";

export default function Timeline({
  jobId,
  videoId,
  pointId    = null, // carried over from Explanation (e.g. "View full timeline") via jobInfo.pointId — same field Explanation/Bookmarks/Library already use, not a new source of truth
  mode       = "standard",
  onOpenPoint = () => {},
  onNavigate  = () => {},
}) {
  const [data,           setData]           = useState(null);
  const [selectedId,     setSelectedId]     = useState(pointId);
  const [activeCategory, setActiveCategory] = useState("all");

  useEffect(() => {
    let cancelled = false;
    getInterventionPoints(jobId, videoId)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        // Honor the point carried over from Explanation if it's actually
        // among this lecture's points; otherwise fall back to the first
        // point, exactly as before pointId existed.
        const initialId = result.points.some((p) => p.id === pointId)
          ? pointId
          : (result.points[0]?.id ?? null);
        if (initialId) setSelectedId(initialId);
      })
      .catch((err) => console.error("Failed to load points:", err));
    return () => { cancelled = true; };
  }, [jobId, pointId]);

  if (!data) {
    return (
      <div className="flex h-full w-full bg-background font-sans overflow-hidden">
        <nav aria-label="Main navigation">
          <Sidebar active="home" onNavigate={onNavigate} />
        </nav>
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 flex items-center justify-center outline-none"
        >
          <div role="status" aria-live="polite" className="text-text-secondary text-[14px]">
            Loading…
          </div>
        </main>
      </div>
    );
  }

  const totalSeconds = parseTimeToSeconds(data.duration);

  // Open-ended category list — derived from the actual points returned,
  // not a hardcoded set, so any category the backend sends (not just
  // equation/diagram/chart/graph) is handled automatically. Sorted
  // alphabetically for a stable, predictable order regardless of what
  // order points happen to arrive in.
  const categories = [...new Set(data.points.map((p) => p.category))].sort();

  const pointsByCategory = categories.reduce((acc, cat) => {
    acc[cat] = data.points.filter((p) => p.category === cat);
    return acc;
  }, {});

  const counts = categories.reduce(
    (acc, cat) => {
      acc[cat] = pointsByCategory[cat].length;
      return acc;
    },
    { all: data.points.length },
  );

  const visiblePoints =
    activeCategory === "all"
      ? data.points
      : data.points.filter((p) => p.category === activeCategory);

  const selectedPoint = data.points.find((p) => p.id === selectedId);
  const thumbnailUrl  = videoId
    ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    : null;

  return (
    <div className="flex h-full w-full bg-background font-sans overflow-hidden">
      <nav aria-label="Main navigation">
        <Sidebar active="home" onNavigate={onNavigate} />
      </nav>

      {/* ── Left pane ─────────────────────────────────────────────────────── */}
      <main
        id="main-content"
        tabIndex={-1}
        aria-label="Lecture timeline"
        className="flex-1 min-w-0 overflow-y-auto border-r border-border-subtle outline-none"
      >
        <div className="px-10 py-10">

          {/* Breadcrumb */}
          <div className="text-[12px] font-medium text-text-secondary mb-7">
            Home
            <span className="mx-2 text-text-muted">›</span>
            <span className="text-text-primary">{data.videoTitle}</span>
          </div>

          {/* ── Compact video header ── */}
          <div className="flex gap-6 items-start mb-9 pb-8 border-b border-border-default">
            {/* Small thumbnail */}
            <div className="w-[180px] shrink-0 aspect-video rounded-radius-md overflow-hidden relative bg-gradient-to-br from-[#3B4870] to-[#8B6B4A] shadow-[0_1px_4px_rgba(22,27,34,0.1)]">
              {thumbnailUrl && (
                <img
                  src={thumbnailUrl}
                  alt="thumbnail"
                  className="w-full h-full object-cover"
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
              )}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full bg-surface/85 flex items-center justify-center">
                  <span className="text-text-primary text-[11px] ml-0.5">▶</span>
                </div>
              </div>
              <div className="absolute bottom-1.5 right-1.5 font-mono text-[9px] bg-black/75 text-white px-1.5 py-0.5 rounded-sm">
                {data.duration}
              </div>
            </div>

            {/* Title + meta + stats */}
            <div className="flex-1 min-w-0">
              <h1 className="text-[22px] font-semibold text-text-primary leading-snug mb-1 truncate">
                {data.videoTitle}
              </h1>
              <div className="text-[12px] text-text-muted mb-5">
                {data.author}
              </div>

              {/* Stat pills */}
              <div className="flex flex-wrap gap-2">
                {[
                  { key: "all", label: "All", count: counts.all, color: "#4A5B8C" },
                  ...categories.map((cat) => ({
                    key: cat,
                    label: capitalize(cat),
                    count: counts[cat],
                    color: getCategoryColor(cat),
                  })),
                ].map((s) => (
                  <span
                    key={s.key}
                    className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border border-border-default bg-surface"
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="text-text-secondary">{s.count}</span>
                    <span className="text-text-muted">{s.label}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* ── Timeline ── */}
          <div className="mb-6">
            <div className="text-[12px] font-medium text-text-secondary mb-4">
              Intervention timeline
            </div>
            <div className="bg-surface border border-border-default rounded-radius-md p-6 pb-4">
              <LaneTimeline
                totalSeconds={totalSeconds}
                categories={categories}
                pointsByCategory={pointsByCategory}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </div>
          </div>

          {/* ── Category filter ── */}
          <div
            role="group"
            aria-label="Filter by category"
            className="flex flex-wrap gap-2 mb-5"
          >
            {[
              { key: "all", label: "All", count: counts.all },
              ...categories.map((cat) => ({
                key: cat,
                label: capitalize(cat),
                count: counts[cat],
              })),
            ].map((cat) => {
              const active = activeCategory === cat.key;
              return (
                <button
                  key={cat.key}
                  aria-pressed={active}
                  onClick={() => setActiveCategory(cat.key)}
                  className={
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary focus-visible:outline-offset-2 " +
                    (active
                      ? "bg-accent-subtle text-text-primary font-semibold border-accent-primary"
                      : "bg-surface text-text-secondary border-border-default hover:bg-surface-muted hover:text-text-primary")
                  }
                >
                  {cat.label}
                  <span className={active ? "text-text-secondary" : "text-text-muted"}>
                    {cat.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── Point list — vertical ── */}
          <div className="space-y-1.5">
            {visiblePoints.map((point) => (
              <PointRow
                key={point.id}
                point={point}
                isSelected={point.id === selectedId}
                onClick={() => setSelectedId(point.id)}
              />
            ))}
          </div>
        </div>
      </main>

      {/* ── Right pane — preview ──────────────────────────────────────────── */}
      <aside
        aria-label="Point preview"
        className="w-[300px] shrink-0 overflow-y-auto bg-surface-muted"
      >
        {selectedPoint ? (
          <PreviewPanel
            point={selectedPoint}
            thumbnailUrl={thumbnailUrl}
            onOpen={() => onOpenPoint(selectedPoint)}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center px-8 text-center">
            <div className="w-10 h-10 rounded-full bg-surface flex items-center justify-center mb-4">
              <span className="text-text-muted text-sm">↑</span>
            </div>
            <p className="text-[12px] text-text-muted leading-relaxed">
              Select a marker on the timeline or a point below to preview it here.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

/* ── Preview panel ───────────────────────────────────────────────────────── */

function PreviewPanel({ point, thumbnailUrl, onOpen }) {
  const color = getCategoryColor(point.category);
  const description = getCategoryDescription(point.category);

  return (
    <div className="p-7">
      {/* Category + timestamp row */}
      <div className="flex items-center justify-between mb-5">
        <span
          className="inline-flex items-center gap-1.5 text-[12px] font-medium"
          style={{ color }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
          {point.category}
        </span>
        <span className="font-mono text-[11px] text-text-muted">
          {point.timestamp}
        </span>
      </div>

      {/* Title */}
      <h2 className="text-[20px] font-semibold text-text-primary leading-snug mb-5">
        {point.title}
      </h2>

      {/* Frame preview */}
      <div className="aspect-video rounded-radius-md overflow-hidden bg-gradient-to-br from-[#3B4870] to-[#8B6B4A] mb-5 relative">
        {thumbnailUrl && (
          <img
            src={thumbnailUrl}
            alt="frame"
            className="w-full h-full object-cover"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        )}
        {/* Timestamp overlay */}
        <div className="absolute bottom-2 right-2 font-mono text-[9px] bg-black/75 text-white px-1.5 py-0.5 rounded-sm">
          {point.timestamp}
        </div>
      </div>

      {/* Description */}
      <p className="text-[12px] text-text-secondary leading-relaxed mb-7">
        {description}
      </p>

      {/* Divider */}
      <div className="border-t border-border-default mb-7" />

      {/* CTA */}
      <button
        onClick={onOpen}
        className="ds-btn-primary w-full justify-center"
      >
        Open explanation
        <span className="text-sm">→</span>
      </button>
    </div>
  );
}

/* ── Point row ───────────────────────────────────────────────────────────── */

function PointRow({ point, isSelected, onClick }) {
  const color = getCategoryColor(point.category);
  return (
    <button
      onClick={onClick}
      className={
        "w-full flex items-center gap-4 px-4 py-3 rounded-radius-md text-left transition-colors border focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary focus-visible:outline-offset-2 " +
        (isSelected
          ? "bg-surface border-border-default shadow-[0_1px_4px_rgba(22,27,34,0.07)]"
          : "bg-surface-muted border-transparent hover:border-border-default")
      }
    >
      {/* Color accent bar */}
      <span
        className="w-0.5 h-8 rounded-full shrink-0"
        style={{ backgroundColor: isSelected ? color : "rgb(var(--border-default))" }}
      />

      {/* Content */}
      <span className="flex-1 min-w-0">
        <span
          className="block text-[11px] font-medium mb-0.5"
          style={{ color }}
        >
          {point.category}
        </span>
        <span className="block text-[14px] text-text-primary leading-snug truncate">
          {point.title}
        </span>
      </span>

      {/* Timestamp */}
      <span className="font-mono text-[11px] text-text-muted shrink-0">
        {point.timestamp}
      </span>

      {/* Arrow on selected */}
      {isSelected && (
        <span className="text-text-muted text-[11px] shrink-0">›</span>
      )}
    </button>
  );
}

/* ── Lane Timeline (SVG) ─────────────────────────────────────────────────── */

function LaneTimeline({ totalSeconds, categories, pointsByCategory, selectedId, onSelect }) {
  const PADDING_LEFT   = 72;
  const PADDING_RIGHT  = 20;
  const VIEWBOX_WIDTH  = 760;
  const TIMELINE_WIDTH = VIEWBOX_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const LANE_H         = 48; // height of each lane band

  // One lane per category actually present, in the same (alphabetical)
  // order categories was derived in — not a fixed 4-lane layout, so any
  // number/mix of categories lays out correctly.
  const LANES = categories.reduce((acc, cat, i) => {
    acc[cat] = 55 + (LANE_H + 12) * i;
    return acc;
  }, {});
  const SVG_HEIGHT = 55 + (LANE_H + 12) * categories.length - 4;

  const timeToX = (s) => PADDING_LEFT + (s / totalSeconds) * TIMELINE_WIDTH;

  // Ruler labels — every minute up to 6 labels
  const numLabels  = Math.min(6, Math.ceil(totalSeconds / 60) + 1);
  const labelStep  = totalSeconds / (numLabels - 1);
  const labels     = Array.from({ length: numLabels }, (_, i) => {
    const secs = Math.round(i * labelStep);
    return { secs, label: secondsToTime(secs), x: timeToX(secs) };
  });

  // All points for playhead lookup — every category, not a fixed subset.
  // (Previously hardcoded to equation/diagram/chart only, which silently
  // hid the playhead whenever a graph-category point was selected.)
  const allPoints = categories.flatMap((cat) => pointsByCategory[cat]);
  const selectedPoint = allPoints.find((p) => p.id === selectedId);
  const playheadX     = selectedPoint
    ? timeToX(parseTimeToSeconds(selectedPoint.timestamp))
    : null;

  return (
    <svg viewBox={`0 0 ${VIEWBOX_WIDTH} ${SVG_HEIGHT}`} width="100%" className="block overflow-visible">

      {/* ── Ruler ── */}
      <line
        x1={PADDING_LEFT} y1={18}
        x2={VIEWBOX_WIDTH - PADDING_RIGHT} y2={18}
        stroke="rgb(var(--border-default))" strokeWidth="0.5"
      />
      {labels.map((l, i) => (
        <g key={i}>
          <line
            x1={l.x} y1={14} x2={l.x} y2={22}
            stroke="rgb(var(--border-default))" strokeWidth="0.5"
          />
          <text
            x={l.x} y={10}
            textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}
            fontFamily="-apple-system, sans-serif" fontSize="8"
            fill="rgb(var(--text-muted))" letterSpacing="0.06em"
          >
            {l.label}
          </text>
        </g>
      ))}

      {/* ── Playhead ── */}
      {playheadX && (
        <line
          x1={playheadX} y1={22}
          x2={playheadX} y2={SVG_HEIGHT}
          stroke="rgb(var(--accent-primary))" strokeWidth="1"
          strokeDasharray="3 3" opacity="0.5"
        />
      )}

      {/* ── Lanes ── */}
      {categories.map((cat) => {
        const y = LANES[cat];
        const color = getCategoryColor(cat);
        return (
          <g key={cat}>
            {/* Lane band */}
            <rect
              x={PADDING_LEFT} y={y - LANE_H / 2}
              width={TIMELINE_WIDTH} height={LANE_H}
              fill={color} fillOpacity="0.05"
              rx="3"
            />
            {/* Lane center line */}
            <line
              x1={PADDING_LEFT} y1={y}
              x2={VIEWBOX_WIDTH - PADDING_RIGHT} y2={y}
              stroke={color} strokeWidth="0.5" strokeOpacity="0.3"
            />
            {/* Lane label */}
            <text
              x={0} y={y + 4}
              fontFamily="-apple-system, sans-serif" fontSize="9"
              fill={color} letterSpacing="0.03em"
            >
              {capitalize(cat)}
            </text>
            {/* Markers */}
            {pointsByCategory[cat].map((point) => (
              <Marker
                key={point.id}
                x={timeToX(parseTimeToSeconds(point.timestamp))}
                y={y}
                color={color}
                isSelected={point.id === selectedId}
                timestamp={point.timestamp}
                onClick={() => onSelect(point.id)}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/* ── Marker ──────────────────────────────────────────────────────────────── */

function Marker({ x, y, color, isSelected, timestamp, onClick }) {
  const size = isSelected ? 12 : 7;

  return (
    <g onClick={onClick} style={{ cursor: "pointer" }}>
      {/* Hit area */}
      <circle cx={x} cy={y} r={16} fill="transparent" />

      {/* Pulse ring on selected */}
      {isSelected && (
        <circle cx={x} cy={y} r={size + 4} fill="none" stroke={color} strokeWidth="1" opacity="0">
          <animate attributeName="r"       values={`${size};${size + 12}`} dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.6;0"                  dur="2s" repeatCount="indefinite" />
        </circle>
      )}

      {/* Dot */}
      <circle
        cx={x} cy={y} r={size}
        fill={isSelected ? color : "#FDFBF5"}
        stroke={color}
        strokeWidth={isSelected ? 0 : 1.5}
      />

      {/* Checkmark on selected */}
      {isSelected && (
        <text x={x} y={y + 4.5} textAnchor="middle"
          fontFamily="-apple-system, sans-serif" fontSize="10" fill="#fff" fontWeight="600">
          ✓
        </text>
      )}

      {/* Timestamp — only on selected */}
      {isSelected && (
        <text x={x} y={y + 26} textAnchor="middle"
          fontFamily="-apple-system, sans-serif" fontSize="8"
          fill={color} fontWeight="500" letterSpacing="0.04em">
          {timestamp}
        </text>
      )}
    </g>
  );
}


/* ── Constants ───────────────────────────────────────────────────────────── */

// Fixed palette of the same colors Timeline has always used for category
// coding (not new/arbitrary colors) — the 4 known categories keep their
// exact original color so nothing visually shifts for existing data; any
// other category gets a deterministic, stable color from this same
// palette via a hash of its name, so a new category never renders as
// undefined/black and never needs a new hardcoded entry here.
const CATEGORY_COLOR_PALETTE = ["#6B5F8C", "#8B6B4A", "#8C5A47", "#4A8C6B"];
const KNOWN_CATEGORY_COLORS = {
  equation: CATEGORY_COLOR_PALETTE[0],
  diagram:  CATEGORY_COLOR_PALETTE[1],
  chart:    CATEGORY_COLOR_PALETTE[2],
  graph:    CATEGORY_COLOR_PALETTE[3],
};

function getCategoryColor(category) {
  if (KNOWN_CATEGORY_COLORS[category]) return KNOWN_CATEGORY_COLORS[category];
  return CATEGORY_COLOR_PALETTE[hashString(category) % CATEGORY_COLOR_PALETTE.length];
}

const CATEGORY_DESCRIPTIONS = {
  equation: "A mathematical expression or formula appears at this moment. Open the explanation to get a step-by-step breakdown of what it means and why it matters in context.",
  diagram:  "A visual diagram is shown here. Open the explanation to understand the relationships and concepts it illustrates.",
  chart:    "A data chart or graph appears at this point. Open the explanation to learn what the data represents and its significance.",
  graph:    "A graph or plot appears here. Open the explanation to understand what the axes represent and what the shape of the graph tells you.",
};
// Deliberately generic — makes no claim about what this category's visual
// actually contains, since there's no real description written for any
// category outside the four above.
const GENERIC_CATEGORY_DESCRIPTION =
  "Open the explanation to learn more about this moment in the lecture.";

function getCategoryDescription(category) {
  return CATEGORY_DESCRIPTIONS[category] ?? GENERIC_CATEGORY_DESCRIPTION;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function parseTimeToSeconds(timeStr) {
  const parts = timeStr.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function secondsToTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Deterministic string hash (not cryptographic) — used only to pick a
// stable, repeatable index into CATEGORY_COLOR_PALETTE for a category name
// that isn't one of the four known ones above.
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // force 32-bit int
  }
  return Math.abs(hash);
}
