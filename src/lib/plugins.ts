import { isTauri, invoke } from '@tauri-apps/api/core';
import type {
  PluginManifest,
  PluginArtifact,
} from '../../public/plugins/v1/types';
import type { Compatibility } from '../plugins/contracts';
export type PluginView = 'store' | 'offline' | 'installed' | 'develop';
export type Inspection = {
  token: string;
  manifest: PluginManifest;
  sha256: string;
  size: number;
  origin: string;
  compatibility: Compatibility;
  trust: 'integrity-only';
};
export type InventoryItem = {
  manifest: PluginManifest;
  sha256: string;
  size: number;
  origin: string;
  installedAt: number;
  trust: 'integrity-only';
  enabled: false;
  compatibility: Compatibility;
  status:
    | 'incompatible'
    | 'platform-unavailable'
    | 'runtime-unsupported'
    | 'disabled';
};
export type CatalogView = {
  name: string;
  publisher: { id: string; name: string };
  source: string;
  entries: {
    manifest: PluginManifest;
    compatibility: Compatibility;
    artifacts: {
      artifact: PluginArtifact;
      offerId: string | null;
      reason: string | null;
    }[];
  }[];
};
export type PluginBridge = {
  native: boolean;
  pick: () => Promise<Inspection | null>;
  list: () => Promise<InventoryItem[]>;
  install: (token: string) => Promise<{
    outcome: 'installed' | 'already-installed';
    item: InventoryItem;
  }>;
  remove: (id: string, version: string) => Promise<void>;
  discard: (token: string) => Promise<void>;
  catalog: (source: string, operationId: string) => Promise<CatalogView>;
  download: (offerId: string, operationId: string) => Promise<Inspection>;
  cancel: (operationId: string) => Promise<void>;
};
const native = <T>(command: string, args?: Record<string, unknown>) => {
  if (!isTauri())
    return Promise.reject(
      new Error(
        'Instalação e catálogo estão disponíveis no aplicativo desktop.',
      ),
    );
  return invoke<T>(command, args);
};
export const pluginBridge: PluginBridge = {
  get native() {
    return isTauri();
  },
  pick: () => native('plugins_pick'),
  list: () => native('plugins_list'),
  install: (token) => native('plugins_install', { token }),
  remove: (id, version) => native('plugins_remove', { id, version }),
  discard: (token) => native('plugins_discard', { token }),
  catalog: (source, operationId) =>
    native('plugins_catalog', { source, operationId }),
  download: (offerId, operationId) =>
    native('plugins_download', { offerId, operationId }),
  cancel: (operationId) => native('plugins_cancel', { operationId }),
};
