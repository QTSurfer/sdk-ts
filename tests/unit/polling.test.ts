import { describe, expect, it } from 'vitest';
import { normalizeStatus } from '../../src/internal/polling';

describe('normalizeStatus', () => {
  it('ends a poll only on a terminal status', () => {
    expect(normalizeStatus('Completed')).toBe('completed');
    expect(normalizeStatus('completed')).toBe('completed');
    expect(normalizeStatus('Failed')).toBe('failed');
    expect(normalizeStatus('Aborted')).toBe('aborted');
    expect(normalizeStatus('CANCELLED')).toBe('aborted');
    expect(normalizeStatus('canceled')).toBe('aborted');
  });

  it('keeps polling on everything else, including a missing status', () => {
    // The API answers 202 with an empty body when a job is known but its result is not readable
    // yet. Absent must mean "ask again", never "finished with no data".
    expect(normalizeStatus(undefined)).toBe('in-progress');
    expect(normalizeStatus(null)).toBe('in-progress');
    expect(normalizeStatus('New')).toBe('in-progress');
    expect(normalizeStatus('Started')).toBe('in-progress');
    expect(normalizeStatus('queued')).toBe('in-progress');
    expect(normalizeStatus('RUNNING')).toBe('in-progress');
  });

  it('treats PARTIAL as terminal without reaching the prepare or execute paths', () => {
    // A sweep that lost a shard is finished and its rows are readable, so polling on would never
    // stop. `PARTIAL` exists only on the two sweep schemas — it is not one of `JobState`'s
    // statuses (New | Started | Completed | Aborted | Failed), which is what prepare and execute
    // report — so folding it into `completed` here cannot change either of those loops.
    expect(normalizeStatus('PARTIAL')).toBe('completed');
    expect(normalizeStatus('partial')).toBe('completed');
    // Every `JobState` status keeps the mapping it had before `partial` was added.
    expect(['New', 'Started', 'Completed', 'Aborted', 'Failed'].map(normalizeStatus)).toEqual([
      'in-progress',
      'in-progress',
      'completed',
      'aborted',
      'failed',
    ]);
  });
});
