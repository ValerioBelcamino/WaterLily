import { afterEach, describe, expect, it, vi } from 'vitest';

import { sampleGraph } from '../sampleGraph';
import { downloadGraph, downloadWaterLilyArchive } from './downloadGraph';

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

  it('downloads a portable archive with the WaterLily extension', () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:archive');
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    downloadWaterLilyArchive(
      {
        bytes: new Uint8Array([80, 75]),
        manifest: {} as never,
        sha256: 'a'.repeat(64),
      },
      'graph-study',
    );

    const anchor = click.mock.instances[0] as HTMLAnchorElement | undefined;
    expect(anchor?.download).toBe('graph-study.waterlily');
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).type).toBe('application/vnd.waterlily+zip');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:archive');
  });
});
