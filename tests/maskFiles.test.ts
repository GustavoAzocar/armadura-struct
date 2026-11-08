import { it, expect, vi, beforeEach, afterEach } from 'vitest';
const mocks = vi.hoisted(() => ({
  tauri: false,
  open: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => mocks.tauri }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: mocks.readFile,
  stat: mocks.stat,
}));
import {
  importMask,
  pickNativeFile,
  pickNativeMaskFiles,
} from '../src/lib/files';
class TestWorker {
  static all: TestWorker[] = [];
  onmessage?: (e: { data: unknown }) => void;
  onerror?: (e: { message: string }) => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    TestWorker.all.push(this);
  }
}
beforeEach(() => {
  mocks.tauri = false;
  vi.clearAllMocks();
  TestWorker.all = [];
  vi.stubGlobal('Worker', TestWorker);
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('abortar durante arrayBuffer não posta no worker, libera recursos e ignora resposta tardia', async () => {
  let release!: (b: ArrayBuffer) => void;
  const file = {
    name: 'cad.dxf',
    size: 10,
    arrayBuffer: () =>
      new Promise<ArrayBuffer>((resolve) => {
        release = resolve;
      }),
  } as File;
  const abort = new AbortController(),
    promise = importMask(file, abort.signal);
  const rejection = expect(promise).rejects.toMatchObject({
    name: 'AbortError',
  });
  abort.abort();
  await rejection;
  release(new ArrayBuffer(10));
  await Promise.resolve();
  const w = TestWorker.all[0];
  expect(w.terminate).toHaveBeenCalledTimes(1);
  expect(w.postMessage).not.toHaveBeenCalled();
  w.onmessage?.({ data: { mask: {} } });
  expect(w.terminate).toHaveBeenCalledTimes(1);
});
it('timeout e erro encerram o worker uma única vez', async () => {
  vi.useFakeTimers();
  const file = new File(['cad'], 'forma.dxf');
  const promise = importMask(file),
    rejected = expect(promise).rejects.toThrow(/60 segundos/);
  await vi.advanceTimersByTimeAsync(60000);
  await rejected;
  expect(TestWorker.all[0].terminate).toHaveBeenCalledTimes(1);
  const second = importMask(file);
  const failed = expect(second).rejects.toThrow(/inválido/);
  TestWorker.all[1].onmessage?.({ data: { error: 'Arquivo inválido' } });
  await failed;
  expect(TestWorker.all[1].terminate).toHaveBeenCalledTimes(1);
});
it('arquivo grande ou sinal já cancelado não cria worker', async () => {
  await expect(importMask({ size: 31 * 1024 * 1024 } as File)).rejects.toThrow(
    /30 MB/,
  );
  const a = new AbortController();
  a.abort();
  await expect(
    importMask(new File(['x'], 'x.dxf'), a.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(TestWorker.all).toHaveLength(0);
});
it('desktop oferece seleção múltipla preguiçosa e mantém seletor de projetos único', async () => {
  mocks.tauri = true;
  mocks.open.mockResolvedValue(['/tmp/a.dxf', '/tmp/b.dwg']);
  mocks.stat.mockResolvedValue({ size: 10 });
  mocks.readFile.mockResolvedValue(new Uint8Array([1, 2]));
  const sources = await pickNativeMaskFiles();
  expect(sources?.map((s) => s.name)).toEqual(['a.dxf', 'b.dwg']);
  expect(mocks.open).toHaveBeenLastCalledWith(
    expect.objectContaining({ multiple: true }),
  );
  expect(mocks.readFile).not.toHaveBeenCalled();
  await sources![1].load(new AbortController().signal);
  expect(mocks.readFile).toHaveBeenCalledExactlyOnceWith('/tmp/b.dwg');
  mocks.stat.mockResolvedValue({ size: 31 * 1024 * 1024 });
  await expect(sources![0].load(new AbortController().signal)).rejects.toThrow(
    /30 MB/,
  );
  expect(mocks.readFile).toHaveBeenCalledTimes(1);
  mocks.open.mockResolvedValue('/tmp/project.json');
  await pickNativeFile(['json']);
  expect(mocks.open).toHaveBeenLastCalledWith(
    expect.objectContaining({ multiple: false }),
  );
});
