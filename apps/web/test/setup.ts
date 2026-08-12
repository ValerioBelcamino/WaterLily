import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

class ResizeObserverStub implements ResizeObserver {
  disconnect(): void {
    // Browser layout is outside component tests.
  }
  observe(): void {
    // Browser layout is outside component tests.
  }
  unobserve(): void {
    // Browser layout is outside component tests.
  }
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: ResizeObserverStub,
});
