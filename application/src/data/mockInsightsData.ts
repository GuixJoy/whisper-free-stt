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
