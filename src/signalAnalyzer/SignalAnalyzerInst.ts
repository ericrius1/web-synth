import { get, type Writable, writable } from 'svelte/store';

import { logError } from 'src/sentry';
import { AsyncOnce } from 'src/util';
import { LineSpectrogramFFTSize } from 'src/visualizations/LineSpectrogram/conf';
import { LineSpectrogram } from 'src/visualizations/LineSpectrogram/LineSpectrogram';
import {
  buildDefaultLineSpecrogramUIState,
  type LineSpectrogramUIState,
} from 'src/visualizations/LineSpectrogram/types';
import { Oscilloscope } from 'src/visualizations/Oscilloscope/Oscilloscope';
import {
  buildDefaultOscilloscopeUIState,
  type OscilloscopeUIState,
} from 'src/visualizations/Oscilloscope/types';
import { ChiField } from 'src/visualizations/ChiField/ChiField';
import {
  buildDefaultChiFieldUIState,
  type ChiFieldUIState,
} from 'src/visualizations/ChiField/types';

const ctx = new AudioContext();
const SignalAnalyzerAWPRegistered = new AsyncOnce(
  () =>
    ctx.audioWorklet.addModule(
      process.env.ASSET_PATH +
        'SignalAnalyzerAWP.js?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : genRandomStringID())
    ),
  true
);

export interface SerializedSignalAnalyzerInst {
  oscilloscopeUIState: OscilloscopeUIState;
  lineSpectrogramUIState: LineSpectrogramUIState;
  chiFieldUIState: ChiFieldUIState;
}

export const buildDefaultSignalAnalyzerInstState = (): SerializedSignalAnalyzerInst => ({
  oscilloscopeUIState: buildDefaultOscilloscopeUIState(),
  lineSpectrogramUIState: buildDefaultLineSpecrogramUIState(),
  chiFieldUIState: buildDefaultChiFieldUIState(),
});

export class SignalAnalyzerInst {
  private destroyed = false;
  public input: AnalyserNode;
  private awpHandle: AudioWorkletNode | null = null;
  public oscilloscope: Oscilloscope;
  public lineSpectrogram: LineSpectrogram;
  private silentGain: GainNode;
  public oscilloscopeUIState: Writable<OscilloscopeUIState>;
  public chiFieldUIState: Writable<ChiFieldUIState>;
  public chiField: ChiField;
  private frequencyDataSAB: SharedArrayBuffer;

  private notifySAB: SharedArrayBuffer;
  private notifySABI32: Int32Array;
  private frequencyDataSAB: SharedArrayBuffer;
  private frequencyDataSABU8: Uint8Array;
  private frequencyDataBufTemp: Uint8Array;
  private running = false;
  private frameIx = 0;

  constructor(ctx: AudioContext, initialState: SerializedSignalAnalyzerInst) {
    this.oscilloscopeUIState = writable(initialState.oscilloscopeUIState);
    this.chiFieldUIState = writable(initialState.chiFieldUIState);
    this.input = ctx.createAnalyser();
    this.input.fftSize = LineSpectrogramFFTSize;
    this.input.minDecibels = initialState.lineSpectrogramUIState.rangeDb[0];
    this.input.maxDecibels = initialState.lineSpectrogramUIState.rangeDb[1];
    this.input.smoothingTimeConstant = initialState.lineSpectrogramUIState.smoothingCoeff;
    this.silentGain = ctx.createGain();
    this.silentGain.gain.value = 0;
    this.silentGain.connect(ctx.destination);

    const bufferSize = Math.max(LineSpectrogramFFTSize / 2, Int32Array.BYTES_PER_ELEMENT * 8);
    this.frequencyDataSAB = new SharedArrayBuffer(bufferSize);

    this.notifySAB = new SharedArrayBuffer(4);
    this.notifySABI32 = new Int32Array(this.notifySAB);
    this.frequencyDataSAB = new SharedArrayBuffer(LineSpectrogramFFTSize / 2);
    this.frequencyDataSABU8 = new Uint8Array(this.frequencyDataSAB); // this is a view over the shared raw buffer. Lets you read/write
    // to the shared buffer as 8-bit unsigned integers
    this.frequencyDataBufTemp = new Uint8Array(LineSpectrogramFFTSize / 2);

    this.oscilloscope = new Oscilloscope(initialState.oscilloscopeUIState);
    this.chiField = new ChiField(
      initialState.chiFieldUIState,
      this.frequencyDataSAB,
      this.notifySAB
    );
    this.lineSpectrogram = new LineSpectrogram(
      initialState.lineSpectrogramUIState,
      this.frequencyDataSAB,
      this.notifySAB
    );

    this.init().catch(err => {
      logError('Error initializing signal analyzer', err);
    });
  }

  private handleAWPMessage = (e: MessageEvent) => {
    switch (e.data.type) {
      case 'setSAB':
        this.oscilloscope.setSAB(e.data.sab);
        break;
      default:
        console.warn(`Unknown message type from signal analyzer AWP: ${(e.data as any).type}`);
    }
  };

  private async init() {
    await SignalAnalyzerAWPRegistered.get();
    if (this.destroyed) {
      console.warn('Signal analyzer already destroyed');
      return;
    }

    this.awpHandle = new AudioWorkletNode(ctx, 'signal-analyzer-awp', {
      numberOfInputs: 1,
      channelCount: 1,
      numberOfOutputs: 1,
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });
    this.awpHandle.port.onmessage = this.handleAWPMessage;
    this.input.connect(this.awpHandle);
    this.awpHandle.connect(this.silentGain);

    this.awpHandle.port.postMessage({ type: 'sendSAB' });
  }

  // We need to drive animation from the main thread because getting the frequency data from the
  // analyser node can only be done on the main thread.
  private animate = () => {
    if (!this.running) {
      return;
    }

    const frameIx = (this.frameIx + 1) % 100_000;
    this.frameIx = frameIx;

    // Browser is hilarious and doesn't let us write to shared buffer directly, so we have to waste a copy.
    this.input.getByteFrequencyData(this.frequencyDataBufTemp);
    // console.log(this.frequencyDataBufTemp[50]);
    this.frequencyDataSABU8.set(this.frequencyDataBufTemp);
    Atomics.store(this.notifySABI32, 0, frameIx);
    Atomics.notify(this.notifySABI32, 0);

    requestAnimationFrame(() => this.animate());
  };

  public pause() {
    this.oscilloscope.pause();
    this.lineSpectrogram.stop();
    this.chiField.stop();
    this.running = false;
  }

  public resume() {
    this.oscilloscope.resume();
    this.lineSpectrogram.start();
    this.chiField.start();

    this.running = true;
    console.log('RESUME');
    this.animate();
  }

  public serialize(): SerializedSignalAnalyzerInst {
    return {
      oscilloscopeUIState: get(this.oscilloscopeUIState),
      lineSpectrogramUIState: this.lineSpectrogram.serialize(),
      chiFieldUIState: get(this.chiFieldUIState),
    };
  }

  public destroy() {
    if (this.destroyed) {
      console.warn('Signal analyzer already destroyed');
      return;
    }
    this.destroyed = true;

    console.warn('DESTROYING SIGNAL ANALYZER');
    this.oscilloscope.destroy();
    this.lineSpectrogram.destroy();
    if (this.awpHandle) {
      this.awpHandle.port.close();
      this.awpHandle.disconnect();
    }
    this.input.disconnect();
    this.silentGain.disconnect();
  }
}
