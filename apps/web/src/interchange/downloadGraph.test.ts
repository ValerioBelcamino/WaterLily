import { afterEach, describe, expect, it, vi } from 'vitest';

import { sampleGraph } from '../sampleGraph';
import { downloadGraph } from './downloadGraph';

describe('downloadGraph', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads canonical checksummed JSON and revokes its object URL', async () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:test');
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const hash = await downloadGraph({
      exportedAt: '2026-08-05T15:00:00.000Z',
      graph: sampleGraph,
      view: { groups: [], positions: {} },
    });

    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    if (!(blob instanceof Blob)) return;
    expect(blob.type).toBe('application/json');
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });

  it('revokes the URL if the browser refuses the download click', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:failed');
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('Downloads blocked');
    });

    await expect(
      downloadGraph({
        exportedAt: '2026-08-05T15:00:00.000Z',
        graph: sampleGraph,
        view: { groups: [], positions: {} },
      }),
    ).rejects.toThrow('Downloads blocked');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:failed');
  });
});
