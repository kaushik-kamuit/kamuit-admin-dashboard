export function money(cents: number | string | null | undefined, currency = "usd"): string {
  if (cents == null) return "—";
  const n = typeof cents === "string" ? Number(cents) : cents;
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(n / 100);
}

export function datetime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function shortId(uuid: string | null | undefined): string {
  if (!uuid) return "—";
  return uuid.slice(0, 8);
}
