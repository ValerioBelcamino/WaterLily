import type { ContentBlock } from '@waterlily/domain';

import type { TokenEstimator } from './types.js';

const encoder = new TextEncoder();

/**
 * A fast, provider-neutral estimate for interactive previews. It deliberately
 * counts text only and must always be labelled approximate in the UI.
 */
export const approximateTextTokenEstimator: TokenEstimator = {
  estimate(blocks: readonly ContentBlock[]): number {
    return blocks.reduce((total, block) => {
      if (block.type !== 'text' || block.text.length === 0) return total;
      return (
        total + Math.max(1, Math.ceil(encoder.encode(block.text).length / 4))
      );
    }, 0);
  },
  id: 'waterlily:utf8-bytes-per-4:v1',
};
