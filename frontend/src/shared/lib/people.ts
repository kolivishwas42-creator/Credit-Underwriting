import { HIDDEN_PEOPLE, HIDDEN_PERSON_LABEL } from "../../config/result";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NAMES = new RegExp(`(^|[^A-Za-z0-9_-])(${HIDDEN_PEOPLE.map(escape).join("|")})(?=$|[^A-Za-z0-9_-])`, "gi");

/** A name as a screen may show it: a development log-in becomes "Officer". */
export function personName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(NAMES, (_m, pre: string) => `${pre}${HIDDEN_PERSON_LABEL}`);
}

/** Every string in an API answer with the development log-in name replaced (objects / arrays walked, a copy made). */
export function withoutDevNames<T>(data: T): T {
  if (typeof data === "string") return personName(data) as unknown as T;
  if (Array.isArray(data)) return data.map((v) => withoutDevNames(v)) as unknown as T;
  if (data && typeof data === "object" && Object.getPrototypeOf(data) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) out[k] = withoutDevNames(v);
    return out as T;
  }
  return data;
}
