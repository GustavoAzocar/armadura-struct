import type { Project } from '../domain/types';
import { decodeProject } from '../domain/model';
export const INITIAL_EXAMPLE_ID = 'example:armadurastruct:1';
export const INITIAL_EXAMPLE_SHEETS = [
  'example:sheet:vigas',
  'example:sheet:pilares',
];
/** Load only when requested; never replace a recoverable local project. */
export async function initialExampleProject(): Promise<Project> {
  const { default: data } = await import('./initial.armstruct.json');
  return decodeProject(JSON.stringify(data));
}
