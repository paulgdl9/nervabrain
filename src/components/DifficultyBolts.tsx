import { Zap } from "lucide-react";

// 1–5 bolt scale, filled up to `level`. Stateless: usable from both server
// and client components.
export function DifficultyBolts({ level, size = 12, label }: { level: number; size?: number; label?: string }) {
  return (
    <span className="difficulty-bolts" role="img" aria-label={label || `Difficulty ${level} out of 5`}>
      {[1, 2, 3, 4, 5].map((bolt) => (
        <Zap key={bolt} size={size} className={bolt <= level ? "is-on" : undefined} aria-hidden />
      ))}
    </span>
  );
}
