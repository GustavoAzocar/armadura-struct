import { z } from 'zod';
import { stirrupHookSchema, stirrupDisplaySchema } from './stirrupSchema';

const n = z.number().finite();
/** Dimensions are measured on the axis to the theoretical vertices, before fillets. */
export const beamClampProfileSchema = z
  .object({
    convention: z.literal('axis-vertices'),
    longitudinal: n.positive().max(100000),
    transverse: n.positive().max(100000),
    /** Physical reflection, independent of which side the schematic closes on. */
    mirrored: z.boolean().optional(),
    start: stirrupHookSchema,
    end: stirrupHookSchema,
  })
  .strict();
export const beamClampDisplaySchema = stirrupDisplaySchema;
/** View settings never participate in physical fabrication. Label coordinates use drawing mm. */
export const beamClampViewSchema = z
  .object({
    mode: z.enum(['perspective', 'development']),
    transverseScale: n.positive().max(2),
    transverseAngle: n.min(5).max(175),
    closedSide: z.enum(['left', 'right']),
    hooks: z.boolean().optional(),
    label: z
      .object({ x: n.min(-1e8).max(1e8), y: n.min(-1e8).max(1e8) })
      .strict()
      .optional(),
  })
  .strict();
export const beamClampCriteriaSchema = z
  .object({
    profile: beamClampProfileSchema,
    diameter: n.positive().max(100),
    mandrel: n.positive().max(2000),
    steel: z.enum(['CA-50', 'CA-60']),
    rotation: n.min(-360000).max(360000),
    quantity: n.int().min(1).max(100000),
    multiplier: n.int().min(1).max(10000),
    distribute: z.boolean(),
    distributionMode: z.enum(['manual', 'quantity', 'spacing']),
    spacing: n.positive().max(100000),
    fit: z.enum(['maximum', 'fixed']),
    startInset: n.nonnegative().max(100000),
    endInset: n.nonnegative().max(100000),
    display: beamClampDisplaySchema,
    view: beamClampViewSchema,
  })
  .strict()
  .refine(
    (c) => !c.distribute || c.distributionMode === 'spacing' || c.quantity >= 2,
    {
      path: ['quantity'],
      message:
        'A distribuição exige ao menos dois grampos de viga. Use quantidade manual para uma peça localizada.',
    },
  );
export type BeamClampProfile = z.infer<typeof beamClampProfileSchema>;
export type BeamClampView = z.infer<typeof beamClampViewSchema>;
export type BeamClampCriteria = z.infer<typeof beamClampCriteriaSchema>;

/** Starting values are editable drafting inputs, never structural recommendations. */
export const defaultBeamClampCriteria = (): BeamClampCriteria => ({
  profile: {
    convention: 'axis-vertices',
    longitudinal: 600,
    transverse: 300,
    start: { angle: 0, mode: 'mm', length: 0, turn: -1 },
    end: { angle: 0, mode: 'mm', length: 0, turn: 1 },
  },
  diameter: 10,
  mandrel: 50,
  steel: 'CA-50',
  rotation: 0,
  quantity: 1,
  multiplier: 1,
  distribute: false,
  distributionMode: 'spacing',
  spacing: 200,
  fit: 'maximum',
  startInset: 0,
  endInset: 0,
  display: { dimensions: true, identification: true, hooks: true },
  view: {
    mode: 'perspective',
    transverseScale: 0.5,
    transverseAngle: 45,
    closedSide: 'left',
  },
});

export function scaleBeamClampProfile(
  p: BeamClampProfile,
  k: number,
): BeamClampProfile {
  const hook = (h: BeamClampProfile['start']) => ({
    ...h,
    length: h.mode === 'mm' ? h.length * k : h.length,
  });
  return {
    ...p,
    longitudinal: p.longitudinal * k,
    transverse: p.transverse * k,
    start: hook(p.start),
    end: hook(p.end),
  };
}

export function scaleBeamClampView(v: BeamClampView, k: number): BeamClampView {
  return {
    ...v,
    ...(v.label ? { label: { x: v.label.x * k, y: v.label.y * k } } : {}),
  };
}

/** Conjugates the oblique view by a physical reflection, so the displayed drawing follows it. */
export function mirrorBeamClampView(v: BeamClampView): BeamClampView {
  return {
    ...v,
    transverseAngle: 180 - v.transverseAngle,
    ...(v.label ? { label: { x: v.label.x, y: -v.label.y } } : {}),
  };
}
