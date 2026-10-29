import { describe, expect, it } from 'vitest';
import { explicitUserDataDir, resolveUserDataDir } from './userDataDir';

describe('explicitUserDataDir', () => {
  it('reads the equals form', () => {
    expect(explicitUserDataDir(['goose', '--user-data-dir=D:\\Goose\\profile'])).toBe(
      'D:\\Goose\\profile'
    );
  });

  it('reads the Windows slash form', () => {
    expect(explicitUserDataDir(['goose', '/user-data-dir=/srv/profile'])).toBe('/srv/profile');
  });

  it('reads the space-separated form', () => {
    expect(explicitUserDataDir(['goose', '--user-data-dir', '/srv/profile'])).toBe('/srv/profile');
  });

  it('ignores a bare switch that is followed by another switch', () => {
    expect(explicitUserDataDir(['goose', '--user-data-dir', '--other'])).toBeNull();
  });

  it('ignores an empty switch value', () => {
    expect(explicitUserDataDir(['goose', '--user-data-dir='])).toBeNull();
  });

  it('returns null when the switch is absent', () => {
    expect(explicitUserDataDir(['goose', 'goose://deep-link'])).toBeNull();
  });
});

describe('resolveUserDataDir', () => {
  it('falls back to GOOSE_USER_DATA_DIR so a bare deep-link launch keeps the bundle profile', () => {
    expect(resolveUserDataDir(['goose'], { GOOSE_USER_DATA_DIR: 'D:\\GooseBundle\\profile' })).toBe(
      'D:\\GooseBundle\\profile'
    );
  });

  it('lets the command line win over the environment', () => {
    expect(
      resolveUserDataDir(['goose', '--user-data-dir=D:\\other'], {
        GOOSE_USER_DATA_DIR: 'D:\\GooseBundle\\profile',
      })
    ).toBe('D:\\other');
  });

  it('treats a blank environment value as unset', () => {
    expect(resolveUserDataDir(['goose'], { GOOSE_USER_DATA_DIR: '   ' })).toBeNull();
  });

  it('trims the environment value', () => {
    expect(resolveUserDataDir(['goose'], { GOOSE_USER_DATA_DIR: ' D:\\p ' })).toBe('D:\\p');
  });

  it('returns null when neither source is set so Electron keeps its default', () => {
    expect(resolveUserDataDir(['goose'], {})).toBeNull();
  });
});
