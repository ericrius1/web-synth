export enum ChiFieldWindowType {
  Beats = 0,
  Seconds = 1,
  Samples = 2,
  Wavelengths = 3,
}

export interface ChiFieldWindow {
  type: ChiFieldWindowType;
  value: number;
}

export type ChiFieldWorkerMessage =
  | { type: 'setSAB'; sab: SharedArrayBuffer }
  | { type: 'setWasmBytes'; wasmBytes: ArrayBuffer }
  | { type: 'setView'; view: OffscreenCanvas; dpr: number }
  | { type: 'setWindow'; window: ChiFieldWindow }
  | { type: 'setFrozen'; frozen: boolean }
  | { type: 'setFrameByFrame'; frameByFrame: boolean }
  | { type: 'resizeView'; newWidth: number; newHeight: number }
  | { type: 'setSnapF0ToMIDI'; snapF0ToMIDI: boolean };

export interface ChiFieldUIState {
  window: ChiFieldWindow;
  lastValueByWindowType: Record<ChiFieldWindowType, number>;
  frozen: boolean;
  frameByFrame: boolean;
  snapF0ToMIDI: boolean;
}

export const buildDefaultChiFieldUIState = (): ChiFieldUIState => ({
  window: {
    type: ChiFieldWindowType.Seconds,
    value: 2,
  },
  lastValueByWindowType: {
    [ChiFieldWindowType.Beats]: 4,
    [ChiFieldWindowType.Seconds]: 2,
    [ChiFieldWindowType.Samples]: 44_100,
    [ChiFieldWindowType.Wavelengths]: 2,
  },
  frozen: false,
  frameByFrame: true,
  snapF0ToMIDI: false,
});
