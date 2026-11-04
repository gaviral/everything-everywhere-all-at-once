import { usePluginState } from '../contract';
import { applyCommand, initialWorkspace, type Artifact, type Command } from './model';

export function useWorkspace(scope: string) {
  const [workspace, update] = usePluginState(scope, initialWorkspace);
  const artifact = workspace.artifacts.find(item => item.id === workspace.selected) ?? workspace.artifacts[0];
  const select = (id: string) => update(old => old.artifacts.some(item => item.id === id) ? { ...old, selected: id } : old);
  const add = (item: Artifact) => update(old => ({ artifacts: [...old.artifacts, item], selected: item.id }));
  const send = (revision: number, command: Command) => update(old => ({ ...old, artifacts: old.artifacts.map(item => item.id === artifact.id ? applyCommand(item, revision, command) : item) }));
  return { workspace, artifact, select, add, send };
}
