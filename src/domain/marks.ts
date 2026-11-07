import { z } from 'zod';
import type { Project } from './types';
export const numberingPolicySchema = z
  .object({
    prefix: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .regex(/^[\p{L}_][\p{L}\p{N}_-]*$/u),
    start: z.number().int().min(1).max(999999999),
    reserved: z.array(z.string().trim().min(1).max(40)).max(10000),
    preservedPositionIds: z.array(z.string().min(1).max(500)).max(10000),
  })
  .strict();
export type NumberingPolicy = z.infer<typeof numberingPolicySchema>;
export const defaultNumbering: NumberingPolicy = {
  prefix: 'N',
  start: 1,
  reserved: [],
  preservedPositionIds: [],
};
export function nextFreeMark(
  p: Pick<Project, 'bars' | 'numbering'>,
  used: Iterable<string> = p.bars.map((b) => b.mark),
  policy = p.numbering ?? defaultNumbering,
) {
  const config = numberingPolicySchema.parse(policy),
    occupied = new Set([...used, ...config.reserved]);
  let n = config.start;
  while (occupied.has(`${config.prefix}${n}`)) {
    n++;
    if (n > 999999999) throw new Error('Faixa de numeração esgotada.');
  }
  return `${config.prefix}${n}`;
}
