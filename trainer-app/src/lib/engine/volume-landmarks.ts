export type VolumeLandmarks = {
  mv: number;
  mev: number;
  mav: number;
  mrv: number;
  sraHours: number;
};

export const VOLUME_LANDMARKS: Record<string, VolumeLandmarks> = {
  "Chest":       { mv: 6,  mev: 10, mav: 16, mrv: 22, sraHours: 60 },
  "Back":        { mv: 6,  mev: 10, mav: 18, mrv: 25, sraHours: 60 },
  "Upper Back":  { mv: 6,  mev: 10, mav: 18, mrv: 25, sraHours: 48 },
  "Front Delts": { mv: 0,  mev: 0,  mav: 7,  mrv: 12, sraHours: 48 },
  "Side Delts":  { mv: 6,  mev: 8,  mav: 19, mrv: 26, sraHours: 36 },
  "Rear Delts":  { mv: 6,  mev: 8,  mav: 19, mrv: 26, sraHours: 36 },
  "Quads":       { mv: 6,  mev: 8,  mav: 15, mrv: 20, sraHours: 72 },
  "Hamstrings":  { mv: 6,  mev: 6,  mav: 13, mrv: 20, sraHours: 72 },
  "Glutes":      { mv: 0,  mev: 0,  mav: 8,  mrv: 16, sraHours: 72 },
  "Biceps":      { mv: 6,  mev: 8,  mav: 17, mrv: 26, sraHours: 36 },
  "Triceps":     { mv: 4,  mev: 6,  mav: 12, mrv: 18, sraHours: 36 },
  "Calves":      { mv: 6,  mev: 8,  mav: 14, mrv: 20, sraHours: 36 },
  "Core":        { mv: 0,  mev: 0,  mav: 12, mrv: 20, sraHours: 36 },
  "Lower Back":  { mv: 0,  mev: 0,  mav: 4,  mrv: 10, sraHours: 72 },
  "Forearms":    { mv: 0,  mev: 0,  mav: 6,  mrv: 12, sraHours: 36 },
  "Adductors":   { mv: 0,  mev: 0,  mav: 8,  mrv: 14, sraHours: 48 },
  "Hip Flexors": { mv: 0,  mev: 0,  mav: 4,  mrv: 8,  sraHours: 36 },
};

export const MUSCLE_SPLIT_MAP: Record<string, "push" | "pull" | "legs"> = {
  "Chest": "push",
  "Front Delts": "push",
  "Side Delts": "push",
  "Triceps": "push",
  "Back": "pull",
  "Upper Back": "pull",
  "Rear Delts": "pull",
  "Biceps": "pull",
  "Forearms": "pull",
  "Quads": "legs",
  "Hamstrings": "legs",
  "Glutes": "legs",
  "Calves": "legs",
  "Adductors": "legs",
  "Hip Flexors": "legs",
  "Core": "legs",
  "Lower Back": "legs",
};
