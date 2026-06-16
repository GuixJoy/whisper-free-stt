export interface StatItem {
  value: string;
  label: string;
  trend?: {
    value: number;
    direction: "up" | "down" | "neutral";
  };
}

export interface UsageCategory {
  name: string;
  words: number;
  maxWords: number;
}

export interface HeatmapDay {
  date: string;
  level: number;
}

export interface StreakInfo {
  current: number;
  longest: number;
}

export const mockStats: StatItem[] = [
  {
    value: "109",
    label: "Words / Min",
    trend: { value: 12, direction: "up" },
  },
  {
    value: "24.6K",
    label: "Total Words",
    trend: { value: 18, direction: "up" },
  },
  {
    value: "7",
    label: "AI Fixes",
    trend: undefined,
  },
];

export const mockUsageCategories: UsageCategory[] = [
  { name: "AI Prompts", words: 8400, maxWords: 10000 },
  { name: "Emails", words: 6200, maxWords: 10000 },
  { name: "Messages", words: 4800, maxWords: 10000 },
  { name: "Documents", words: 3200, maxWords: 10000 },
  { name: "Other", words: 2000, maxWords: 10000 },
];

export const mockStreak: StreakInfo = {
  current: 0,
  longest: 10,
};

function generateHeatmapData(): HeatmapDay[] {
  const days: HeatmapDay[] = [];
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 182);

  for (let i = 0; i < 182; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const dayOfWeek = date.getDay();

    let level = 0;
    const rand = Math.random();

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      if (rand < 0.3) level = 1;
      else if (rand < 0.45) level = 2;
      else if (rand < 0.52) level = 3;
      else if (rand < 0.55) level = 4;
    } else {
      if (rand < 0.15) level = 0;
      else if (rand < 0.45) level = 1;
      else if (rand < 0.7) level = 2;
      else if (rand < 0.88) level = 3;
      else level = 4;
    }

    days.push({
      date: date.toISOString().split("T")[0],
      level,
    });
  }

  return days;
}

export const mockHeatmap: HeatmapDay[] = generateHeatmapData();
