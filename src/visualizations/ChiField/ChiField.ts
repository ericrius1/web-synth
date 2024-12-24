import { get, type Writable, writable } from 'svelte/store';

import type { ChiFieldUIState, ChiFieldWorkerMessage } from 'src/visualizations/ChiField/types';

/**
 * Visualization of the immediate spectrum of audio input signal.  Uses `AnalyserNode` to perform STFFT and
 * `OffscreenCanvas` to render the spectrogram.  The spectrogram is rendered as a smooth line with the line's
 * Y position at each point representing the amplitude of the frequency at that point.
 */
export class ChiField {
  public store: Writable<ChiFieldUIState>;
  private renderWorker: Worker;
  private frequencyDataSAB: SharedArrayBuffer;
  private notifySAB: SharedArrayBuffer;
  private running = false;

  constructor(
    initialState: ChiFieldUIState,
    frequencyDataSAB: SharedArrayBuffer,
    notifySAB: SharedArrayBuffer
  ) {
    this.store = writable(initialState);

    this.renderWorker = new Worker(new URL('./ChiFieldRenderer.worker', import.meta.url));

    this.frequencyDataSAB = frequencyDataSAB;
    this.notifySAB = notifySAB;

    this.init();
  }

  public getSharedArrayBuffer(): SharedArrayBuffer {
    return this.frequencyDataSAB;
  }

  private async init() {
    const msg: ChiFieldWorkerMessage = {
      type: 'init',
      frequencyDataSAB: this.frequencyDataSAB,
      notifySAB: this.notifySAB,
    };
    this.renderWorker.postMessage(msg);
  }

  // We need to drive animation from the main thread because getting the frequency data from the
  // analyser node can only be done on the main thread.
  private animate = () => {
    if (!this.running) {
      return;
    }

    requestAnimationFrame(() => this.animate());
  };

  public setCanvas(canvas: OffscreenCanvas, dpr: number) {
    if (dpr !== Math.floor(dpr)) {
      throw new Error('dpr must be an integer');
    }

    const msg: ChiFieldWorkerMessage = { type: 'setCanvas', canvas, dpr };
    this.renderWorker.postMessage(msg, [canvas]);
  }

  public resizeView(width: number, height: number) {
    const msg: ChiFieldWorkerMessage = { type: 'resizeCanvas', width, height };
    this.renderWorker.postMessage(msg);
  }

  public start() {}

  public stop() {}

  public destroy() {
    this.renderWorker.terminate();
  }

  public serialize(): ChiFieldUIState {
    return get(this.store);
  }
}
