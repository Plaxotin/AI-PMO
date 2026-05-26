import { describe, expect, it, vi } from 'vitest';
import { withAuth } from '@/lib/api/route-helpers';
import { getAuthResult } from '@/lib/auth/session';

vi.mock('@/lib/auth/session', () => ({
  getAuthResult: vi.fn(),
  authHeaders: vi.fn(() => ({})),
}));

const getAuthResultMock = vi.mocked(getAuthResult);

describe('withAuth', () => {
  it('allows unauthenticated requests in MVP mode', async () => {
    getAuthResultMock.mockResolvedValue({ mode: 'unauthenticated' });

    const result = await withAuth();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auth.mode).toBe('unauthenticated');
    }
  });

  it('can enforce session when explicitly requested', async () => {
    getAuthResultMock.mockResolvedValue({ mode: 'unauthenticated' });

    const result = await withAuth({ requireSession: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });
});
