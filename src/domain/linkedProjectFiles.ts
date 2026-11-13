import type { Project } from './types';

const deviceName =
  /^(?:con|prn|aux|nul|conin\$|conout\$|(?:com|lpt)[1-9¹²³])(?:\.|$)/i;
const invalidChar = /[<>:"\\|?*\p{Cc}]/u;

export function projectFilePath(value: unknown): string {
  if (typeof value !== 'string') {
    throw Error('Caminho de arquivo vinculado inválido.');
  }
  const parts = value.split('/');
  if (
    parts[0].toUpperCase() === 'SAVE-V1' ||
    parts.some(
      (part) =>
        !part ||
        part.endsWith('.') ||
        part.endsWith(' ') ||
        invalidChar.test(part) ||
        deviceName.test(part),
    )
  ) {
    throw Error('Use um arquivo dentro da pasta do projeto, fora de save-v1.');
  }
  return value;
}

const fileKey = (path: string) => path.normalize('NFC').toLowerCase();

export function decodeLinkedProjectFiles(value: unknown): string[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value))
    throw Error('Lista de arquivos vinculados inválida.');
  const paths = value.map(projectFilePath);
  if (new Set(paths.map(fileKey)).size !== paths.length)
    throw Error('Há arquivos vinculados repetidos.');
  return paths;
}

export function linkProjectFile(project: Project, path: string): Project {
  const validated = projectFilePath(path);
  const paths = project.linkedFiles ?? [];
  if (paths.some((entry) => fileKey(entry) === fileKey(validated)))
    return project;
  return {
    ...project,
    linkedFiles: decodeLinkedProjectFiles([...paths, validated]),
  };
}

export const isLinkedProjectDocument = (path: string) =>
  path.toLowerCase().endsWith('.armstruct.json');
