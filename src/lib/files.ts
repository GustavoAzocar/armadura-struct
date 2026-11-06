import { isTauri } from '@tauri-apps/api/core';
import type { Mask, Project } from '../domain/types';
export async function pickNativeFile(
  extensions: string[],
): Promise<File | null | undefined> {
  if (!isTauri()) return undefined;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: extensions.join(' / ').toUpperCase(), extensions }],
  });
  if (!path || Array.isArray(path)) return null;
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const data = await readFile(path);
  return new File(
    [new Uint8Array(data).buffer],
    path.split(/[\\/]/).at(-1) || 'desenho',
  );
}
export const safeName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 80) || 'armaduras';
export async function saveFile(
  name: string,
  data: string | Uint8Array,
  mime: string,
  extension: string,
) {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      defaultPath: name,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (!path) return false;
    const fs = await import('@tauri-apps/plugin-fs');
    if (typeof data === 'string') await fs.writeTextFile(path, data);
    else await fs.writeFile(path, data);
    return true;
  }
  const blob = new Blob(
    [typeof data === 'string' ? data : new Uint8Array(data).buffer],
    { type: mime },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}
export function importMask(file: File): Promise<Mask> {
  return new Promise((resolve, reject) => {
    if (file.size > 30 * 1024 * 1024) {
      reject(new Error('Use uma máscara de até 30 MB nesta versão.'));
      return;
    }
    const worker = new Worker(
      new URL('../cad/import.worker.ts', import.meta.url),
      { type: 'module' },
    );
    const timer = setTimeout(() => {
      worker.terminate();
      reject(
        new Error(
          'Leitura interrompida após 60 segundos. Simplifique o arquivo ou use DXF.',
        ),
      );
    }, 60000);
    const end = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (e) => {
      end();
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.mask);
    };
    worker.onerror = (e) => {
      end();
      reject(new Error(e.message || 'Não foi possível iniciar o leitor CAD.'));
    };
    file
      .arrayBuffer()
      .then((buffer) =>
        worker.postMessage(
          {
            name: file.name,
            buffer,
            base: new URL(
              `${import.meta.env.BASE_URL}wasm`,
              window.location.origin,
            ).href,
          },
          [buffer],
        ),
      )
      .catch((e) => {
        end();
        reject(e);
      });
  });
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('armadurastruct', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('projects');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function autosave(p: Project) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('projects', 'readwrite');
      tx.objectStore('projects').put(JSON.stringify(p), 'current');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function restore(): Promise<string | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const req = db
        .transaction('projects')
        .objectStore('projects')
        .get('current');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
