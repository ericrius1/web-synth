export type ChiFieldWorkerMessage =
  | {
      type: 'init';
      frequencyDataSAB: SharedArrayBuffer;
      notifySAB: SharedArrayBuffer;
    }
  | {
      type: 'setCanvas';
      canvas: OffscreenCanvas;
      dpr: number;
    }
  | { type: 'resizeCanvas'; width: number; height: number }
  | { type: 'start' }
  | { type: 'stop' };

export interface ChiFieldUIState {
  rangeDb: [number, number];
  smoothingCoeff: number;
}

export const buildDefaultChiFieldUIState = (): ChiFieldUIState => ({
  rangeDb: [-80, -20],
  smoothingCoeff: 0.9,
});
