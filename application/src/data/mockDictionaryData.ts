export type DictionaryCategory = "name" | "technical" | "abbreviation" | "custom";

export interface DictionaryEntry {
  id: string;
  phrase: string;
  replacement: string;
  category: DictionaryCategory;
  notes: string;
  useCount: number;
  isFavorite: boolean;
  createdAt: string;
}

export const CATEGORY_META: Record<DictionaryCategory, { label: string; color: string; bg: string }> = {
  name: { label: "Name", color: "#F6B15F", bg: "rgba(246,177,95,0.12)" },
  technical: { label: "Technical", color: "#7A9BAE", bg: "rgba(122,155,174,0.12)" },
  abbreviation: { label: "Abbreviation", color: "#9B8ABF", bg: "rgba(155,138,191,0.12)" },
  custom: { label: "Custom", color: "#7A7F87", bg: "rgba(122,127,135,0.12)" },
};

