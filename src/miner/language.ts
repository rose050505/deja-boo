/**
 * Infer programming language from a file path using the REQ-8 lookup table.
 * Returns 'unknown' for unrecognised extensions.
 */

const EXT_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.swift': 'swift',
  '.php': 'php',
  '.sh': 'shell',
  '.bash': 'shell',
  '.md': 'markdown',
};

/** Detect language from file path extension. Returns 'unknown' for unrecognised paths. */
export function detectLanguage(filePath: string): string {
  // Find the last dot, but only in the basename (after the last slash).
  const slashIdx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const basename = slashIdx >= 0 ? filePath.slice(slashIdx + 1) : filePath;
  const dotIdx = basename.lastIndexOf('.');
  if (dotIdx < 0) return 'unknown';
  const ext = basename.slice(dotIdx);
  return EXT_MAP[ext] ?? 'unknown';
}
