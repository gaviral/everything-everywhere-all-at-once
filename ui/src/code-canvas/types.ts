export type CodeFunction = { id: string; name: string; file: string; line: number; end_line: number; lines: number; branches: number; calls: string[]; unresolved: number; reasons: string[] };
export type CodeBranch = { name: string; tip: string; parent: string | null; fork: string | null; state: string; current: boolean; ahead: number; behind: number };
export type Snapshot = { functions: CodeFunction[]; branches: CodeBranch[]; files: number; warnings: string[] };
export type Piece = { id: string; name: string; children: Piece[]; functions: CodeFunction[]; count: number };
export function pieces(functions: CodeFunction[]): Piece[] {
  const roots: Piece[] = [];
  for (const f of functions) {
    const parts = f.file.split('/'); parts.splice(1, 1);
    let level = roots;
    let prefix = '';
    for (const part of parts) {
      prefix += `/${part}`;
      let node = level.find(n => n.id === prefix);
      if (!node) { node = { id: prefix, name: part === 'core' ? 'Rust core' : part === 'ui' ? 'TypeScript interface' : part.replace(/\.(rs|tsx?)$/, '').replace(/[-_]/g, ' '), children: [], functions: [], count: 0 }; level.push(node); }
      node.count++;
      if (part === parts.at(-1)) node.functions.push(f);
      level = node.children;
    }
  }
  return roots;
}
