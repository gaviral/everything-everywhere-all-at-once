export const GROUPS = [
  { id: 'talk', name: 'Talk', why: 'Let a thought out.', color: '#edc975', ids: [
    'listening', 'partner', 'built-in-speech', 'my-words', 'voice-shortcuts', 'live-outline',
    'tiny-transcript', 'dictation-breakdown', 'clarify', 'level', 'trigger-parts',
    'voice-policy-comparison', 'reply-format', 'quiet-solo-attribution', 'repeat-thoughts', 'draft-pocket',
  ] },
  { id: 'draw', name: 'Draw', why: 'Give an idea a shape.', color: '#97b9b2', ids: [
    'draw', 'shapes', 'sketch-exchange', 'sketch-labels', 'pen-devices', 'spine', 'pictures',
    'topic-images', 'warm-pictures', 'loose-topics', 'rotate-canvas', 'semantic-zoom', 'bubble-flight',
  ] },
  { id: 'build', name: 'Build', why: 'Turn a thought into work.', color: '#c7b1d1', ids: [
    'flow-canvas', 'workshop', 'app-recipes', 'helpers', 'work-spine', 'canvas-workflow', 'work-list',
    'dependency-sequences', 'worktree-map', 'workflow-inspector', 'live-area', 'part-dimensions',
    'app-connections', 'plugins', 'action-estimates', 'next-steps', 'session-focus', 'countdown',
    'machine-demo', 'native-receipts', 'usage', 'canvas-tools', 'learned-action-labels', 'typed-lists',
  ] },
  { id: 'understand', name: 'Understand', why: 'Find the meaning in it.', color: '#b7c991', ids: [
    'advisor', 'clarification', 'question-research', 'research-walkthrough', 'related-thoughts',
    'thinking-starters', 'part-lenses', 'i-compact', 'reading-format', 'contextual-folds', 'topic-views',
    'view-instances', 'full-content', 'terse', 'cards', 'conversation-spine', 'focused-find',
    'bring-here', 'topic-reshape', 'stable-topic-titles', 'placement-details', 'brick-chip',
    'intro-parts', 'light-theme', 'keys', 'catalog-canvas', 'choice-map',
  ] },
  { id: 'remember', name: 'Remember', why: 'Pick up where you left off.', color: '#d6a68e', ids: [
    'project-memory', 'place-drafts', 'read-progress', 'thought-replay', 'saved-questions', 'saved-answers',
    'sticky-notes', 'recap', 'decision-history', 'decisions', 'notice-timeline', 'reload-session',
    'reuse-explanations', 'compare-return-controls', 'self-heal', 'care-prompts',
  ] },
  { id: 'share', name: 'Share', why: 'Make it better together.', color: '#a9bddc', ids: [
    'email', 'export', 'import', 'topic-brief', 'anchored-discussions', 'discussion-status',
    'explicit-agreement', 'revision-review', 'review-text-edits', 'result-review', 'concurrent-work',
    'image-evidence', 'phone-remote', 'phone-pointer', 'phone-correction', 'phone-topic-overview',
    'compare-phone-reading', 'take-checklist', 'placeholder-mode', 'hackathon', 'demo-parts',
    'demo-variants', 'populated-variants', 'showroom',
  ] },
] as const;
export type GroupId = typeof GROUPS[number]['id'];
export const groupOf = (id: string): GroupId => GROUPS.find(group => (group.ids as readonly string[]).includes(id))?.id ?? 'build';
