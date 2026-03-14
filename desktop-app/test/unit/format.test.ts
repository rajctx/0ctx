import { describe, expect, it } from 'vitest';
import { compactPath, workstreamKey } from '../../src/renderer/lib/format';

describe('renderer helpers', () => {
  it('builds a stable workstream key', () => {
    expect(workstreamKey('main', 'C:/repo')).toBe('main::C:/repo');
  });

  it('shortens very long paths', () => {
    expect(compactPath('C:/Users/name/projects/very-long-folder-name/another-folder/repo')).toContain('...');
  });
});
