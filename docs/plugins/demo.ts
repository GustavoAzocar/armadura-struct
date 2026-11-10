/** Conformance-only example. Never imported/executed by the plugin manager. */
import manifest from '../../examples/plugins/straight-bar/manifest.json';
import {
  validateManifest,
  validateParameters,
  type RebarGeneratorOutput,
} from '../../src/pluginApi';
export const exampleManifest = validateManifest(manifest);
export function straightBarOutput(
  detailId: string,
  raw: unknown,
): RebarGeneratorOutput {
  const p = validateParameters(exampleManifest, 'straight-bar', raw) as {
    length: number;
    quantity: number;
  };
  return {
    format: 'rebar-batch/1',
    apiVersion: '1.0',
    units: { length: 'mm', angle: 'deg' },
    commands: [
      {
        type: 'bar.create',
        id: 'plugin-demo-native-bar',
        detailId,
        definition: {
          kind: 'free',
          points: [
            { x: 0, y: 0 },
            { x: p.length, y: 0 },
          ],
          diameter: 10,
          mandrel: 50,
          steel: 'CA-50',
          quantity: p.quantity,
        },
      },
    ],
  };
}
