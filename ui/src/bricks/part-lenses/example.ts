import type { Contribution } from '../../msg1351/part-dimensions';
import type { Explanation, PartTree } from './tree';

// Synthetic content, visibly labelled in every lens. Identity and topology use the
// same canonical graph / Contribution contract as Part dimensions.
const descriptions: Record<string, Explanation & { title: string; tag: 'view' | 'function' | 'data' }> = {
  map: { title: 'Conversation map', tag: 'view',
    plain: 'Give every thought a place to belong.',
    detail: 'A conversation can go in many directions. The map keeps the thoughts together and makes the current topic easy to find.',
    pitch: 'Turn a wandering conversation into a shared sense of direction.',
    audience: 'Teams thinking together', benefit: 'Less time finding the topic. More time moving the idea forward.',
    classModel: { name: 'ConversationMap', superclass: 'ViewPart', subclass: 'FocusedConversationMap' } },
  card: { title: 'Thought card', tag: 'view',
    plain: 'Keep one idea easy to read, and easy to trace.',
    detail: 'A card brings the words and the person who said them into one small, readable place.',
    pitch: 'Make every contribution visible, without losing who said it.',
    audience: 'Everyone in the conversation', benefit: 'An idea stays readable and its author stays in view.',
    classModel: { name: 'ThoughtCard', superclass: 'ViewPart', subclass: 'HighlightedThoughtCard' } },
  text: { title: 'Point text', tag: 'data',
    plain: 'Hold on to the words that carry the idea.',
    detail: 'This is the readable thought inside the card. The surrounding card gives it a place; this part gives it words.',
    pitch: 'Keep the idea in the words people actually used.',
    audience: 'People returning to a conversation', benefit: 'Read the thought itself, without guessing what the label meant.',
    classModel: { name: 'PointText', superclass: 'DataPart', subclass: 'QuotedPointText' } },
  speaker: { title: 'Speaker tag', tag: 'view',
    plain: 'Show who brought this idea into the conversation.',
    detail: 'A small name beside the thought preserves its connection to the person who said it.',
    pitch: 'Keep people attached to their contributions.',
    audience: 'Collaborators reading a shared map', benefit: 'Know whose perspective you are reading.',
    classModel: { name: 'SpeakerTag', superclass: 'ViewPart', subclass: 'CompactSpeakerTag' } },
  focus: { title: 'Topic focus', tag: 'function',
    plain: 'Make it clear which topic you are following.',
    detail: 'Focus connects the chosen topic to what the map shows next. The selected topic ID is the small piece of information it needs.',
    pitch: 'Give a busy conversation one clear place to look next.',
    audience: 'Teams exploring several ideas', benefit: 'Follow one topic while the bigger conversation stays available.',
    classModel: { name: 'TopicFocus', superclass: 'BehaviorPart', subclass: 'KeyboardTopicFocus' } },
  selection: { title: 'Selected topic ID', tag: 'data',
    plain: 'Remember which topic has your attention.',
    detail: 'A small identifier points to the chosen topic. The focus part uses it to keep the view on that topic.',
    pitch: 'Keep your place while the conversation grows.',
    audience: 'People moving between topics', benefit: 'A precise reference keeps the chosen topic unambiguous.',
    classModel: { name: 'SelectedTopicId', superclass: 'DataPart', subclass: 'RestoredTopicId' } },
};

const node = (id: string, children: Contribution[] = []): Contribution => ({ part: { id: `example:${id}`, version: 1 }, children });

export const exampleTree: PartTree = {
  label: 'Example · a conversation map',
  graph: { parts: Object.entries(descriptions).map(([id, description]) => ({
    id: `example:${id}`, name: description.title, file: `example/${id}.tsx`, line: 1,
    tags: [description.tag], version: 1, version_scope: 'illustrative example',
  })) },
  tree: [node('map', [node('card', [node('text'), node('speaker')]), node('focus', [node('selection')])])],
  explanations: Object.fromEntries(Object.entries(descriptions).map(([id, description]) => [`example:${id}@1`, description])),
};
