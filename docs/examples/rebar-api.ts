import { emptyProject } from '../../src/domain/model';
import {
  applyRebarBatch,
  executeRebarBatch,
  type RebarCommand,
} from '../../src/api';

/** A native project produced headlessly with the same operations used by the editor. */
export function createRebarApiExample() {
  const project = emptyProject();
  project.name = 'Conjunto criado pela API OpenStruct';
  project.hierarchy.details[0].name = 'V1 · conjunto API';
  const detailId = project.hierarchy.details[0].id;
  const commands: RebarCommand[] = [
    {
      type: 'bar.create',
      id: 'api-longitudinal',
      detailId,
      definition: {
        kind: 'free',
        mark: 'N1',
        diameter: 12.5,
        mandrel: 62.5,
        steel: 'CA-50',
        quantity: 3,
        origin: { x: 0, y: 0 },
        points: [
          { x: 0, y: 200 },
          { x: 0, y: 0 },
          { x: 3000, y: 0 },
          { x: 3000, y: 200 },
        ],
      },
    },
    {
      type: 'representation.create',
      id: 'api-rebatimento',
      barId: 'api-longitudinal',
      origin: { x: 0, y: -500 },
    },
    {
      type: 'bar.create',
      id: 'api-stirrup',
      detailId,
      definition: {
        kind: 'stirrup',
        mark: 'N2',
        diameter: 6.3,
        mandrel: 31.5,
        steel: 'CA-50',
        quantity: 1,
        width: 220,
        height: 440,
        hook: 65,
        origin: { x: 3500, y: 0 },
      },
    },
    {
      type: 'distribution.set',
      barId: 'api-stirrup',
      distribution: { end: { x: 4500, y: 0 }, render: 'bars' },
      count: { mode: 'spacing', spacing: 150 },
    },
  ];
  const result = executeRebarBatch(project, commands, {
    apiVersion: '1.0',
    units: 'mm',
  });
  return { project: applyRebarBatch(project, result), result };
}
