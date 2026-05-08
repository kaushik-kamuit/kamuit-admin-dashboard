import clsx from "clsx";

const CLASS_BY_STATUS: Record<string, string> = {
  REQUESTED: "badge-slate",
  OFFER_SENT: "badge-blue",
  ACCEPTED: "badge-purple",
  PICKUP_ARRIVING: "badge-blue",
  IN_PROGRESS: "badge-blue",
  DROPOFF_ARRIVING: "badge-blue",
  COMPLETED: "badge-green",
  CANCELLED: "badge-red",

  OPEN: "badge-blue",
  PARTIALLY_FILLED: "badge-yellow",

  PENDING: "badge-slate",
  OFFERED: "badge-blue",
  DECLINED: "badge-red",
  EXPIRED: "badge-slate",

  approved: "badge-green",
  pending: "badge-yellow",
  rejected: "badge-red",

  succeeded: "badge-green",
  requires_capture: "badge-yellow",
  canceled: "badge-slate",
  failed: "badge-red",
};

export default function StatusBadge({ value }: { value?: string | null }) {
  if (!value) return <span className="badge badge-slate">—</span>;
  const cls = CLASS_BY_STATUS[value] ?? "badge-slate";
  return <span className={clsx("badge", cls)}>{value}</span>;
}
