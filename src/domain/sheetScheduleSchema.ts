import { z } from 'zod';
import type { Point, SheetSteelSchedule } from './types';

export const sheetSteelScheduleSchema = z
  .object({
    origin: z
      .object({
        x: z.number().finite().min(-1e9).max(1e9),
        y: z.number().finite().min(-1e9).max(1e9),
      })
      .strict(),
    textHeight: z.number().finite().min(1.8).max(5),
    allowancePercent: z.number().finite().min(0).max(100),
    /** Perda das telas soldadas (%), sobre a massa aplicada; ausente = 0. */
    meshLossPercent: z.number().finite().min(0).max(100).optional(),
  })
  .strict();
export const defaultSheetSchedule = (
  origin: Point = { x: 20, y: 270 },
): SheetSteelSchedule => ({ origin, textHeight: 2.5, allowancePercent: 10 });
