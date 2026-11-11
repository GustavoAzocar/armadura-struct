import { z } from 'zod';

const n = z.number().finite();

/**
 * Operational software limits, checked before any graphic array is allocated.
 * They are not structural or normative limits.
 */
export const HELIX_LIMITS = Object.freeze({
  /** Axial lengths, diameters and pitches in mm. */
  maxLength: 1_000_000,
  maxDiameter: 20_000,
  /** Total turns N = H / p of one piece. */
  maxTurns: 5_000,
  /**
   * Points of the longitudinal projection (whole piece), before the exact
   * front/back split points. With at least 8 points per turn, maxTurns × 8
   * stays below this budget.
   */
  maxProjectionPoints: 50_000,
  /** Chord sagitta of the projected drawing, in model mm. */
  projectionTolerance: 0.5,
});

/**
 * Diameter references. D is always the helix axis diameter (bar centerline):
 * - axis: D = value;
 * - external: outer steel envelope, D = value − φ;
 * - concrete: concrete section with radial cover to the outer face of the
 *   helix, D = value − 2c − φ.
 */
export const helixDiameterSchema = z.discriminatedUnion('reference', [
  z
    .object({
      reference: z.literal('axis'),
      value: n.positive().max(HELIX_LIMITS.maxDiameter),
    })
    .strict(),
  z
    .object({
      reference: z.literal('external'),
      value: n.positive().max(HELIX_LIMITS.maxDiameter),
    })
    .strict(),
  z
    .object({
      reference: z.literal('concrete'),
      value: n.positive().max(HELIX_LIMITS.maxDiameter),
      cover: n.nonnegative().max(HELIX_LIMITS.maxDiameter),
    })
    .strict(),
]);

/**
 * Physical definition of one constant-diameter, constant-pitch circular helix.
 * Placement: Bar.origin is A (start center of the reference section) and
 * Bar.rotation is the direction A→B in degrees. `span` is the single declared
 * source of the axial extent: either the gross |B − A| or the useful H.
 */
export const helixProfileSchema = z
  .object({
    convention: z.literal('axis-centerline'),
    diameter: helixDiameterSchema,
    span: z
      .object({
        source: z.enum(['gross', 'useful']),
        value: n.positive().max(HELIX_LIMITS.maxLength),
      })
      .strict(),
    startOffset: n.nonnegative().max(HELIX_LIMITS.maxLength),
    endOffset: n.nonnegative().max(HELIX_LIMITS.maxLength),
    /** Axial advance per complete turn, never a spacing between pieces. */
    pitch: n.positive().max(HELIX_LIMITS.maxLength),
    /**
     * right (s = +1): right-handed helix, like a common screw thread. Looking
     * from B back towards A, the bar turns counterclockwise while advancing.
     */
    hand: z.enum(['right', 'left']),
    /** Initial angle θ0 in degrees, measured from the drawing-plane normal. */
    phase: n.min(-360).max(360),
    /** This delivery models no terminations, hooks, end rings or laps. */
    ends: z.literal('none'),
  })
  .strict();

/** Presentation only; never participates in fabrication or quantities. */
export const helixDisplaySchema = z
  .object({
    dimensions: z.boolean(),
    identification: z.boolean(),
    /** Linked circular section drawn beside the projection (same piece). */
    section: z.boolean(),
    /** Local identification anchor, in drawing mm relative to A. */
    label: z
      .object({ x: n.min(-1e8).max(1e8), y: n.min(-1e8).max(1e8) })
      .strict()
      .optional(),
  })
  .strict();

export const helixCriteriaSchema = z
  .object({
    profile: helixProfileSchema,
    diameter: n.positive().max(100),
    steel: z.enum(['CA-50', 'CA-60']),
    /** Identical helices; independent of the (fractional) number of turns. */
    quantity: n.int().min(1).max(100000),
    multiplier: n.int().min(1).max(10000),
    display: helixDisplaySchema,
  })
  .strict();

export type HelixDiameter = z.infer<typeof helixDiameterSchema>;
export type HelixProfile = z.infer<typeof helixProfileSchema>;
export type HelixDisplay = z.infer<typeof helixDisplaySchema>;
export type HelixCriteria = z.infer<typeof helixCriteriaSchema>;

/** Editable drafting inputs, never structural recommendations. */
export const defaultHelixCriteria = (): HelixCriteria => ({
  profile: {
    convention: 'axis-centerline',
    diameter: { reference: 'axis', value: 400 },
    span: { source: 'gross', value: 3000 },
    startOffset: 0,
    endOffset: 0,
    pitch: 150,
    hand: 'right',
    phase: 0,
    ends: 'none',
  },
  diameter: 8,
  steel: 'CA-50',
  quantity: 1,
  multiplier: 1,
  display: { dimensions: true, identification: true, section: true },
});

/** Unit conversion of every length; angles, hand and counts never scale. */
export function scaleHelixProfile(p: HelixProfile, k: number): HelixProfile {
  return {
    ...p,
    diameter:
      p.diameter.reference === 'concrete'
        ? {
            ...p.diameter,
            value: p.diameter.value * k,
            cover: p.diameter.cover * k,
          }
        : { ...p.diameter, value: p.diameter.value * k },
    span: { ...p.span, value: p.span.value * k },
    startOffset: p.startOffset * k,
    endOffset: p.endOffset * k,
    pitch: p.pitch * k,
  };
}

export function scaleHelixDisplay(d: HelixDisplay, k: number): HelixDisplay {
  return {
    ...d,
    ...(d.label ? { label: { x: d.label.x * k, y: d.label.y * k } } : {}),
  };
}

/**
 * Physical reflection in the drawing plane (local y → −y, depth kept):
 * θ' = π − θ, so the hand flips and θ0' = 180° − θ0.
 */
export function mirrorHelixProfile(p: HelixProfile): HelixProfile {
  const phase = 180 - p.phase;
  return {
    ...p,
    hand: p.hand === 'right' ? 'left' : 'right',
    phase: ((((phase + 180) % 360) + 360) % 360) - 180,
  };
}

export function mirrorHelixDisplay(d: HelixDisplay): HelixDisplay {
  return {
    ...d,
    ...(d.label ? { label: { x: d.label.x, y: -d.label.y } } : {}),
  };
}
