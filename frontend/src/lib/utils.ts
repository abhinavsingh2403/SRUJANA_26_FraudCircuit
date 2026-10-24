import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function truncateId(id: string, maxLen = 16): string {
  if (id.length <= maxLen) return id;
  return id.slice(0, maxLen - 1) + "…";
}

export function formatAmount(value: number, currency?: string | null): string {
  const formatted = value.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
  });
  if (currency) return `${currency} ${formatted}`;
  return formatted;
}

export function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      day: "2-digit",
      month: "short",
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

export function formatTimeShort(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}
