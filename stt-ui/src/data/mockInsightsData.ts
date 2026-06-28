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

export interface WeeklyWord {
  label: string;
  words: number;
}
