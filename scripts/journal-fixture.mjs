// Read fixture journals as the core replays them: legacy changes and complete version-1 batches.
import assert from 'node:assert/strict';

export function decodeJournal(source) {
  const lines = source.split('\n');
  return lines.flatMap((line, index) => {
    if (!line.trim()) return [];
    const record = JSON.parse(line);
    assert.ok(record && !Array.isArray(record) && typeof record.type === 'string', 'journal change has a type');
    if (record.type !== 'journal_batch') return [record];
    assert.ok(index < lines.length - 1, 'journal batch has a terminal newline');
    assert.deepEqual(Object.keys(record).sort(), ['changes', 'type', 'version'], 'known journal batch envelope');
    assert.equal(record.version, 1, 'supported journal batch');
    assert.ok(Array.isArray(record.changes) && record.changes.length > 0 && record.changes.every(change =>
      change && !Array.isArray(change) && typeof change.type === 'string' && change.type !== 'journal_batch'), 'complete journal changes');
    return record.changes;
  });
}
