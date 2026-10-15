import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const sql = vi.fn() as ReturnType<typeof vi.fn> & { unsafe: (text: string) => unknown };
  sql.unsafe = (text: string) => text; // scoped-db column fragments
  return { sql, isAdmin: vi.fn(), getAuthenticatedUser: vi.fn() };
});

vi.mock('@/lib/db', () => ({ default: mocks.sql }));
vi.mock('@/lib/auth-utils', () => ({ isAdmin: mocks.isAdmin, getAuthenticatedUser: mocks.getAuthenticatedUser }));

import { DELETE, GET, POST } from './route';

const request = (method: 'POST' | 'DELETE') => new Request('http://localhost/api/settings/barcodes', { method });

describe('legacy Barcode V1 write lock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdmin.mockResolvedValue(true);
    mocks.getAuthenticatedUser.mockResolvedValue(null);
  });

  it('keeps the anonymous V1 list working while departments are off (legacy)', async () => {
    mocks.sql.mockResolvedValue([{ id: 1, name: 'Legacy' }]);

    const response = await GET(new Request('http://localhost/api/settings/barcodes'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{ id: 1, name: 'Legacy' }]);
  });

  it.each([POST, DELETE])('rejects Admin %p requests without changing V1 patterns', async (handler) => {
    const response = await handler(request(handler === POST ? 'POST' : 'DELETE'));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('อ่านอย่างเดียว') });
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('keeps the Admin boundary before the write-lock response', async () => {
    mocks.isAdmin.mockResolvedValue(false);

    const response = await POST(request('POST'));

    expect(response.status).toBe(401);
    expect(mocks.sql).not.toHaveBeenCalled();
  });
});
