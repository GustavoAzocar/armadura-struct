/** Nominal steel density used by every schedule, memory and output (kg/m³). */
export const STEEL_DENSITY = 7850;

/** Central nominal mass policy: kg for a total length in m and a bar diameter in mm. */
export function nominalWeight(totalLengthM: number, diameterMm: number) {
  return (
    ((totalLengthM * Math.PI * (diameterMm / 1000) ** 2) / 4) * STEEL_DENSITY
  );
}
