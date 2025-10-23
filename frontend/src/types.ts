export type TopItem = { label: string; proba: number };

export type BBox = [number, number, number, number];

export type PredictSingleResponse = {
  label: string;
  proba: number;
  top3?: TopItem[];
  recyclable?: boolean;
  latency_ms?: number;
};

export type ManyItem = {
  box: [number, number, number, number];
  material: string;
  score: number;
  recyclable?: boolean;
};

export type PredictManyResponse = {
  items: ManyItem[];
  counts: Record<string, number>;
  latency_ms?: number;
};
