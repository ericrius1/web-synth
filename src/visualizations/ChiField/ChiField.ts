import { logError } from 'src/sentry';
import { AsyncOnce } from 'src/util';
import type {
  ChiFieldUIState,
  ChiFieldWindowType,
  ChiFieldWorkerMessage,
} from 'src/visualizations/ChiField/types';

const ChiFieldWasmBytes = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'oscilloscope.wasm?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : genRandomStringID())
    ).then(res => res.arrayBuffer()),
  true
);

export class ChiField {
  private renderWorker: Worker;
  private sab: Int32Array = new Int32Array(8);

  constructor(initialState: ChiFieldUIState) {
    this.renderWorker = new Worker(new URL('./ChiFieldRenderer.worker', import.meta.url));
    this.init().catch(err => {
      logError('Error initializing chi-field', err);
    });

    this.setWindow(initialState.window.type, initialState.window.value);
    this.setFrozen(initialState.frozen);
    this.setFrameByFrame(initialState.frameByFrame);
  }

  private async init() {
    const wasmBytes = await ChiFieldWasmBytes.get();
    const msg: ChiFieldWorkerMessage = { type: 'setWasmBytes', wasmBytes };
    this.renderWorker.postMessage(msg);
  }

  public setSAB(sab: SharedArrayBuffer) {
    this.sab = new Int32Array(sab);
    const msg: ChiFieldWorkerMessage = { type: 'setSAB', sab };
    this.renderWorker.postMessage(msg);
  }

  public setView(view: OffscreenCanvas, dpr: number) {
    // dpr must be an integer
    if (dpr !== Math.floor(dpr)) {
      throw new Error('dpr must be an integer for oscilloscope');
    }
    this.renderWorker.postMessage({ type: 'setView', view, dpr }, [view]);
  }

  public resizeView(newWidth: number, newHeight: number) {
    const msg: ChiFieldWorkerMessage = { type: 'resizeView', newWidth, newHeight };
    this.renderWorker.postMessage(msg);
  }

  public setWindow(newWindowType: ChiFieldWindowType, newWindowLength: number) {
    const msg: ChiFieldWorkerMessage = {
      type: 'setWindow',
      window: { type: newWindowType, value: newWindowLength },
    };
    this.renderWorker.postMessage(msg);
  }

  public setFrozen(frozen: boolean) {
    const msg: ChiFieldWorkerMessage = { type: 'setFrozen', frozen };
    this.renderWorker.postMessage(msg);
  }

  public setFrameByFrame(frameByFrame: boolean) {
    const msg: ChiFieldWorkerMessage = { type: 'setFrameByFrame', frameByFrame };
    this.renderWorker.postMessage(msg);
  }

  public setSnapF0ToMIDI(snapF0ToMIDI: boolean) {
    const msg: ChiFieldWorkerMessage = { type: 'setSnapF0ToMIDI', snapF0ToMIDI };
    this.renderWorker.postMessage(msg);
  }

  public pause() {
    Atomics.store(this.sab, 0, 1);
  }

  public resume() {
    Atomics.store(this.sab, 0, 0);
  }

  public destroy() {
    this.renderWorker.terminate();
  }
}
