import { BookOpen, Hash } from "lucide-react";

const phrases = [
  { text: "thank you so much", count: 47 },
  { text: "let me know", count: 32 },
  { text: "sounds good", count: 28 },
  { text: "I think we should", count: 24 },
  { text: "can you help me", count: 21 },
  { text: "that's a great idea", count: 18 },
];

const customVocab = [
  { word: "Floure", uses: 89, accuracy: "98%" },
  { word: "Tauri", uses: 67, accuracy: "96%" },
  { word: "PyTorch", uses: 34, accuracy: "94%" },
  { word: "CUDA", uses: 23, accuracy: "97%" },
];

export default function VocabularyCard() {
  return (
    <div className="rounded-[14px] bg-white border border-border px-5 py-4 min-h-[180px]">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="flex items-center justify-center w-[26px] h-[26px] rounded-[7px] bg-app-surface-secondary">
          <BookOpen size={14} className="text-accent" />
        </div>
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold text-text-primary leading-tight">Vocabulary Insights</span>
          <span className="text-[11px] text-text-muted leading-tight mt-0.5">Most used phrases and custom words</span>
        </div>
      </div>

      {/* Most Used Phrases */}
      <div className="mb-4">
        <span className="text-[11px] text-text-muted uppercase tracking-wide font-medium mb-2 block">Most Used Phrases</span>
        <div className="flex flex-wrap gap-1.5">
          {phrases.map((p) => (
            <span
              key={p.text}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] bg-accent-surface text-[11px] text-accent font-medium"
            >
              {p.text}
              <span className="text-[10px] text-accent/60">{p.count}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Custom Vocabulary */}
      <div>
        <span className="text-[11px] text-text-muted uppercase tracking-wide font-medium mb-2 block">Custom Vocabulary</span>
        <div className="flex flex-col gap-2">
          {customVocab.map((v) => (
            <div key={v.word} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Hash size={11} className="text-text-muted" />
                <span className="text-[12px] text-text-secondary font-medium">{v.word}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-text-muted">{v.uses} uses</span>
                <span className="text-[11px] text-accent font-medium">{v.accuracy}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
