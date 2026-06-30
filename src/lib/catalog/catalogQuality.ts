import type { Part } from "@/types/parts";

/** Reject catalog rows whose derived structural fields contradict the model
 * identity. These rows remain visible for audit, but cannot enter automatic
 * recommendations until their source data is corrected. */
export function catalogIdentityIssue(part: Part): string | undefined {
  if (part.category !== "cpu" || part.performanceDataKind !== "derived") return undefined;
  const intelCore = part.name.match(/\bcore\s+i[3579][ -]?(\d{4,5})/i);
  if (intelCore) {
    const model = Number(intelCore[1]);
    const generation = model >= 10_000 ? Math.floor(model / 1000) : Math.floor(model / 1000);
    if (part.socket === "LGA1700" && (generation < 12 || generation > 14)) return `${part.name} is not a 12th-14th Gen LGA1700 CPU`;
    if (part.socket === "LGA1851") return `${part.name} is not a Core Ultra 200-series LGA1851 CPU`;
  }
  if (part.socket === "LGA1851" && !/\bcore\s+ultra\s+[3579].*\b2\d{2}[a-z]*\b/i.test(part.name)) return `${part.name} has an unverified LGA1851 identity`;

  const ryzen = part.name.match(/\bryzen\s+[3579]\s+(\d{4})/i);
  if (ryzen) {
    const series = Number(ryzen[1][0]);
    if (part.socket === "AM5" && ![7, 8, 9].includes(series)) return `${part.name} is not an AM5 Ryzen 7000/8000/9000-series CPU`;
    if (part.socket === "AM4" && [7, 8, 9].includes(series)) return `${part.name} has an unverified AM4 identity`;
  }
  return undefined;
}

export function isCatalogPartSelectable(part: Part) {
  return !catalogIdentityIssue(part);
}
