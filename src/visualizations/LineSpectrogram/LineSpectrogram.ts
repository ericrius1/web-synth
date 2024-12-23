import { get, type Writable, writable } from 'svelte/store';

import { logError } from 'src/sentry';
import { AsyncOnce } from 'src/util';
import { LineSpectrogramFFTSize } from 'src/visualizations/LineSpectrogram/conf';
import type {
  LineSpectrogramUIState,
  LineSpectrogramWorkerMessage,
} from 'src/visualizations/LineSpectrogram/types';

const LineSpectrogramWasmBytes = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'spectrum_viz_full.wasm?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : genRandomStringID())
    ).then(res => res.arrayBuffer()),
  true
);

/**
 * Visualization of the immediate spectrum of audio input signal.  Uses `AnalyserNode` to perform STFFT and
 * `OffscreenCanvas` to render the spectrogram.  The spectrogram is rendered as a smooth line with the line's
 * Y position at each point representing the amplitude of the frequency at that point.
 */
export class LineSpectrogram {
  public store: Writable<LineSpectrogramUIState>;
  private renderWorker: Worker;
  private sharedFFTBuffer: SharedArrayBuffer;
  private notifySAB: SharedArrayBuffer;

  constructor(
    initialState: LineSpectrogramUIState,
    sharedFFTBuffer: SharedArrayBuffer,
    notifySAB: SharedArrayBuffer
  ) {
    this.store = writable(initialState);
    this.sharedFFTBuffer = sharedFFTBuffer;
    this.notifySAB = notifySAB;
    this.renderWorker = new Worker(new URL('./LineSpectrogram.worker', import.meta.url));

    this.init().catch(err => {
      logError('Error initializing oscilloscope', err);
    });
  }

  private async init() {
    const wasmBytes = await LineSpectrogramWasmBytes.get();
    const msg: LineSpectrogramWorkerMessage = {
      type: 'setWasmBytes',
      wasmBytes,
      frequencyDataSAB: this.sharedFFTBuffer,
      notifySAB: this.notifySAB,
    };
    this.renderWorker.postMessage(msg);
  }

  public setCanvas(canvas: OffscreenCanvas, dpr: number) {
    if (dpr !== Math.floor(dpr)) {
      throw new Error('dpr must be an integer');
    }

    const msg: LineSpectrogramWorkerMessage = { type: 'setCanvas', canvas, dpr };
    this.renderWorker.postMessage(msg, [canvas]);
  }

  public resizeView(width: number, height: number) {
    const msg: LineSpectrogramWorkerMessage = { type: 'resizeCanvas', width, height };
    this.renderWorker.postMessage(msg);
  }

  public stop() {}
  public start() {}

  public destroy() {
    this.renderWorker.terminate();
  }

  public serialize(): LineSpectrogramUIState {
    return get(this.store);
  }
}
