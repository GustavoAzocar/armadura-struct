import { decodeProject } from '../domain/model';
import type { RecoveryCopy } from './periodicRecovery';

self.onmessage = ({ data }: MessageEvent<RecoveryCopy[]>) => {
  self.postMessage(
    data.map(({ projectId, raw }) => {
      try {
        return decodeProject(raw).id === projectId;
      } catch {
        return false;
      }
    }),
  );
};
