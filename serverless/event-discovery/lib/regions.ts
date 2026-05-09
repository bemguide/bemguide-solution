import type { Region } from "./types.js";

export const REGIONS: Record<string, Region> = {
  dnipro: { id: "dnipro", name_uk: "Дніпро", oblast_uk: "Дніпропетровська" },
  kyiv: { id: "kyiv", name_uk: "Київ", oblast_uk: "м. Київ" },
  lviv: { id: "lviv", name_uk: "Львів", oblast_uk: "Львівська" },
  odesa: { id: "odesa", name_uk: "Одеса", oblast_uk: "Одеська" },
  kharkiv: { id: "kharkiv", name_uk: "Харків", oblast_uk: "Харківська" },
  poltava: { id: "poltava", name_uk: "Полтава", oblast_uk: "Полтавська" },
  vinnytsia: { id: "vinnytsia", name_uk: "Вінниця", oblast_uk: "Вінницька" },
  zaporizhzhia: { id: "zaporizhzhia", name_uk: "Запоріжжя", oblast_uk: "Запорізька" },
};

export function getRegion(id: string): Region {
  const r = REGIONS[id];
  if (!r) throw new Error(`Unknown region: ${id}`);
  return r;
}
