import { MATERIAL_COLORS } from "../constants";

export function CountsTable({ counts }: { counts: Record<string, number> }) {
  const mats = Object.keys(counts).sort();
  if (mats.length === 0) return <div className="muted">—</div>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Material</th>
          <th style={{ textAlign: 'right' }}>Count</th>
        </tr>
      </thead>
      <tbody>
        {mats.map((m) => (
          <tr key={m}>
            <td>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span className="dot" style={{ background: MATERIAL_COLORS[m] || "#d1d5db" }} />
                {m}
              </span>
            </td>
            <td style={{ textAlign: 'right' }}>{counts[m]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
