import type { Bar, Geometry, Point } from './types';
import { nominalWeight } from './steel';
import {
  HELIX_LIMITS,
  helixProfileSchema,
  type HelixDiameter,
  type HelixProfile,
} from './helixSchema';

/** Shared numeric tolerance for helix fixtures, equivalence and diagnostics. */
export const HELIX_TOLERANCE = 1e-9;

export type HelixMetrics = {
  /** Bar diameter φ (mm). */
  phi: number;
  /** Helix axis diameter D (mm), always on the bar centerline. */
  D: number;
  R: number;
  /** |B − A| along the axis, in mm. */
  gross: number;
  startOffset: number;
  endOffset: number;
  /** Useful axial height H = gross − a − b (mm). */
  H: number;
  pitch: number;
  /** Real number of turns N = H / p, possibly fractional. */
  turns: number;
  /** s ∈ {−1, +1}. */
  hand: 1 | -1;
  /** θ0 and θ(1) in radians. */
  startAngle: number;
  endAngle: number;
  /** Local axial stations (from A) of the useful start/end. */
  start: number;
  end: number;
  /** Lcorpo = hypot(π·D·N, H): developed length of the circular body. */
  bodyLength: number;
  /** Current policy: no added parcels, so Lcorte = Lcorpo. */
  cutLength: number;
  errors: string[];
};

/** D on the bar axis for the selected diameter reference. */
export function helixAxisDiameter(d: HelixDiameter, phi: number): number {
  if (d.reference === 'axis') return d.value;
  if (d.reference === 'external') return d.value - phi;
  return d.value - 2 * d.cover - phi;
}

/** Numerically stable developed length of a constant-pitch circular helix. */
export function helixDevelopedLength(D: number, H: number, pitch: number) {
  return Math.hypot(Math.PI * D * (H / pitch), H);
}

export function helixReferenceLabel(d: HelixDiameter): string {
  return d.reference === 'axis'
    ? 'diâmetro no eixo da barra'
    : d.reference === 'external'
      ? 'diâmetro externo da hélice'
      : 'seção de concreto + cobrimento';
}

/** Turns for presentation: integers stay exact, fractions show 3 decimals. */
export function formatTurns(turns: number): string {
  const rounded = Math.round(turns);
  return Math.abs(turns - rounded) < 1e-9
    ? String(rounded)
    : turns.toLocaleString('pt-BR', {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      });
}

const invalid = (errors: string[]): HelixMetrics => ({
  phi: 0,
  D: 0,
  R: 0,
  gross: 0,
  startOffset: 0,
  endOffset: 0,
  H: 0,
  pitch: 0,
  turns: 0,
  hand: 1,
  startAngle: 0,
  endAngle: 0,
  start: 0,
  end: 0,
  bodyLength: 0,
  cutLength: 0,
  errors,
});

/** Single source for D, H, N and L used by geometry, memory, schedule and outputs. */
export function helixMetrics(
  b: Pick<Bar, 'kind' | 'diameter'> & { helix?: HelixProfile },
): HelixMetrics {
  const parsed = helixProfileSchema.safeParse(b.helix);
  if (b.kind !== 'helix' || !parsed.success)
    return invalid([
      'Revise os parâmetros da hélice: diâmetro, trecho, afastamentos, passo, sentido e fase devem ser finitos e dentro dos limites.',
    ]);
  const phi = b.diameter;
  if (!Number.isFinite(phi) || !(phi > 0) || phi > 100)
    return invalid(['Informe uma bitola φ finita, positiva e até 100 mm.']);
  const p = parsed.data;
  const errors: string[] = [];
  const D = helixAxisDiameter(p.diameter, phi);
  if (!Number.isFinite(D) || !(D > 0))
    errors.push(
      `A referência informada resulta em D no eixo = ${round(D)} mm, que não é positivo. Revise o diâmetro, o cobrimento e a bitola.`,
    );
  else if (D <= phi + HELIX_TOLERANCE)
    errors.push(
      `D no eixo (${round(D)} mm) deve ser maior que a bitola φ (${round(phi)} mm): o diâmetro interno do aço seria nulo.`,
    );
  const gross =
    p.span.source === 'gross'
      ? p.span.value
      : p.span.value + p.startOffset + p.endOffset;
  const H =
    p.span.source === 'gross'
      ? p.span.value - p.startOffset - p.endOffset
      : p.span.value;
  if (!(H > 0))
    errors.push(
      'Os afastamentos não deixam trecho útil: H = Hbruto − a − b precisa ser positivo.',
    );
  if (gross > HELIX_LIMITS.maxLength)
    errors.push(
      `Limite do software: o trecho bruto não pode exceder ${HELIX_LIMITS.maxLength / 1000} m.`,
    );
  const turns = H / p.pitch;
  if (H > 0 && turns > HELIX_LIMITS.maxTurns)
    errors.push(
      `Limite do software: no máximo ${HELIX_LIMITS.maxTurns.toLocaleString('pt-BR')} voltas por peça (N = ${formatTurns(turns)}). Revise o passo ou o trecho.`,
    );
  if (D > phi && H > 0 && turns > 1) {
    // Perpendicular distance between adjacent turns: p · cos(α), tan(α) = p / (πD).
    const clearance =
      (p.pitch * Math.PI * D) / Math.hypot(Math.PI * D, p.pitch);
    if (clearance < phi - HELIX_TOLERANCE)
      errors.push(
        `As voltas se sobrepõem: com p = ${round(p.pitch)} mm a distância entre voltas adjacentes é ${round(clearance)} mm, menor que a bitola φ = ${round(phi)} mm (incompatibilidade geométrica, não verificação normativa).`,
      );
  }
  const hand = p.hand === 'right' ? 1 : -1;
  const startAngle = (p.phase * Math.PI) / 180;
  const endAngle = startAngle + hand * 2 * Math.PI * turns;
  const bodyLength = helixDevelopedLength(D, H, p.pitch);
  if (!errors.length && (!Number.isFinite(bodyLength) || !(bodyLength > 0)))
    errors.push('Comprimento desenvolvido inválido para a hélice.');
  const start = p.startOffset,
    end = gross - p.endOffset;
  return {
    phi,
    D,
    R: D / 2,
    gross,
    startOffset: p.startOffset,
    endOffset: p.endOffset,
    H,
    pitch: p.pitch,
    turns,
    hand,
    startAngle,
    endAngle,
    start,
    end,
    bodyLength: errors.length ? 0 : bodyLength,
    cutLength: errors.length ? 0 : bodyLength,
    errors,
  };
}

const round = (n: number) =>
  Number.isFinite(n)
    ? n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
    : String(n);

/**
 * Spatial point at parameter t ∈ [0, 1] in the local frame: x along A→B
 * (axial, from A), y along the drawing-plane normal (left of A→B) and w
 * towards the observer. x̂ = y, ŷ = w and ẑ = x form a right-handed base.
 */
export function helixPoint(
  m: Pick<HelixMetrics, 'R' | 'H' | 'start' | 'startAngle' | 'endAngle'>,
  t: number,
): { x: number; y: number; w: number } {
  const theta = m.startAngle + (m.endAngle - m.startAngle) * t;
  return {
    x: m.start + m.H * t,
    y: m.R * Math.cos(theta),
    w: m.R * Math.sin(theta),
  };
}

/**
 * Physical definition stays parametric: no graphic segment is returned as the
 * physical axis. `vertices` are the axis end centers A and B (local), and the
 * length is the analytic developed length of the body.
 */
export function helixGeometry(b: Bar): Geometry {
  const m = helixMetrics(b);
  return {
    segments: [],
    vertices: m.errors.length
      ? [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ]
      : [
          { x: 0, y: 0 },
          { x: m.gross, y: 0 },
        ],
    length: m.cutLength,
    errors: m.errors,
  };
}

/** Independent check: fine polyline length of the spatial curve (tests only). */
export function helixSampledLength(m: HelixMetrics, steps: number): number {
  let total = 0;
  let previous = helixPoint(m, 0);
  for (let i = 1; i <= steps; i++) {
    const next = helixPoint(m, i / steps);
    total += Math.hypot(
      next.x - previous.x,
      next.y - previous.y,
      next.w - previous.w,
    );
    previous = next;
  }
  return total;
}

const mm = (n: number, digits = 1) =>
  n.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/**
 * Simple calculation memory. Every row derives from helixMetrics; the total
 * quantity is helices × armature multiplier × detail repetition, applied once.
 */
export function helixMemory(
  b: Bar,
  quantity?: { quantity: number; multiplier: number; repetitions: number },
): { label: string; value: string }[] {
  const m = helixMetrics(b);
  if (m.errors.length || !b.helix)
    return [{ label: 'Hélice', value: m.errors.join(' ') }];
  const d = b.helix.diameter;
  const reference =
    d.reference === 'axis'
      ? `D = ${mm(d.value)} mm informado no eixo`
      : d.reference === 'external'
        ? `Dext = ${mm(d.value)} mm → D = Dext − φ`
        : `Dconc = ${mm(d.value)} mm, c = ${mm(d.cover)} mm → D = Dconc − 2c − φ`;
  const linear = nominalWeight(1, b.diameter);
  const unit = nominalWeight(m.cutLength / 1000, b.diameter);
  const rows = [
    { label: 'Referência do diâmetro', value: helixReferenceLabel(d) },
    { label: 'Valores informados', value: reference },
    { label: 'Bitola φ', value: `${mm(m.phi)} mm` },
    { label: 'D no eixo da barra', value: `${mm(m.D, 3)} mm` },
    {
      label: 'Trecho',
      value: `Hbruto = ${mm(m.gross)} mm · a = ${mm(m.startOffset)} mm · b = ${mm(m.endOffset)} mm`,
    },
    { label: 'Altura axial útil H', value: `${mm(m.H)} mm` },
    { label: 'Passo p (volta completa)', value: `${mm(m.pitch)} mm` },
    {
      label: 'Número de voltas N = H / p',
      value: `${formatTurns(m.turns)} (${Math.floor(m.turns + 1e-9)} completas + ${mm(Math.max(0, m.turns - Math.floor(m.turns + 1e-9)), 3)})`,
    },
    {
      label: 'Lcorpo = √((π·D·N)² + H²)',
      value: `${mm(m.bodyLength, 3)} mm`,
    },
    {
      label: 'Parcelas adicionais',
      value: 'nenhuma: sem ganchos, anéis, voltas extras ou transpasse',
    },
    {
      label: 'Comprimento de corte',
      value: `${mm(m.cutLength, 3)} mm = ${mm(m.cutLength / 1000, 3)} m`,
    },
    {
      label: 'Massa nominal (7.850 kg/m³)',
      value: `${mm(linear, 4)} kg/m · ${mm(unit, 3)} kg por hélice`,
    },
  ];
  if (quantity)
    rows.push({
      label: 'Quantidade física',
      value: `${b.quantity} hélice(s) × ${quantity.multiplier} × ${quantity.repetitions} = ${quantity.quantity} · ${mm((m.cutLength / 1000) * quantity.quantity, 3)} m · ${mm(nominalWeight((m.cutLength / 1000) * quantity.quantity, b.diameter), 3)} kg`,
    });
  return rows;
}

/** Local axis end points A and B. */
export function helixAxis(m: HelixMetrics): [Point, Point] {
  return [
    { x: 0, y: 0 },
    { x: m.gross, y: 0 },
  ];
}
