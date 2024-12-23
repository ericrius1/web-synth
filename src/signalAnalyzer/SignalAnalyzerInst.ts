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
  private sharedFFTBuffer: SharedArrayBuffer;

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
    this.sharedFFTBuffer = new SharedArrayBuffer(bufferSize);

    this.oscilloscope = new Oscilloscope(initialState.oscilloscopeUIState);
    this.chiField = new ChiField(initialState.chiFieldUIState, this.sharedFFTBuffer);
    this.lineSpectrogram = new LineSpectrogram(
      initialState.lineSpectrogramUIState,
      this.input
      // this.sharedFFTBuffer
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

  public pause() {
    this.oscilloscope.pause();
    this.lineSpectrogram.stop();
  }

  public resume() {
    this.oscilloscope.resume();
    this.lineSpectrogram.start();
    this.chiField.start();
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
