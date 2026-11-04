import type { Thread, Thought } from '../contract';
import type { Material } from './model';

const topic = (id: string, title: string, parent_id: string | null = null): Thread => ({ id, title, parent_id,
  status: 'open', last_point: '', touched_ms: 1, tags: [], picture: null, dropped_by: '' });
const thought = (id: string, thread_id: string, speaker: string, text: string, point: string, at_ms: number): Thought => ({
  id, thread_id, speaker, text, point, at_ms, placed: true, complete: true, unclear: '', place_ms: 0,
});

export const example: Material = {
  example: true,
  threads: [topic('example-garden', 'A garden for everyone'), topic('example-opening', 'The first visit', 'example-garden'), topic('example-care', 'Keep it growing', 'example-garden')],
  thoughts: [
    thought('example-1', 'example-garden', 'Alex', 'Let’s turn the empty courtyard into a little community garden.', 'A community garden in the courtyard.', 1),
    thought('example-2', 'example-opening', 'Sam', 'For the opening, let people plant one seed and take a small pot home.', 'Plant a seed. Take a pot home.', 2),
    thought('example-3', 'example-care', 'Alex', 'We’ll need a watering rota so the garden keeps growing after opening day.', 'Make a watering rota.', 3),
    thought('example-4', 'example-opening', 'Alex', 'Yes, and put a welcome table beside the entrance so nobody wonders where to go.', 'A welcome table at the entrance.', 4),
  ],
};
