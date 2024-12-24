class ChiFieldRendererWorker {
  private canvas: OffscreenCanvas | null = null;
  private context: GPUCanvasContext | null = null;
  private device: GPUDevice | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;

  private startTime = performance.now();
  private notifySABI32: Int32Array | null = null;
  private frequencyDataSABU8: Uint8Array | null = null;
  private running = true;
  /**
   * Used to uniquely identify the current animation loop to avoid having more than one
   * animation loop running at a time.
   */
  private runToken: number | null = null;
  async handleMessage(evt: MessageEvent) {
    switch (evt.data.type) {
      case 'init':
        this.notifySABI32 = new Int32Array(evt.data.notifySAB);
        this.frequencyDataSABU8 = new Uint8Array(evt.data.frequencyDataSAB);
        await this.initWebGPU(evt.data.canvas, evt.data.dpr);
        break;

      case 'resize':
        if (this.canvas) {
          this.canvas.width = evt.data.width;
          this.canvas.height = evt.data.height;
          await this.setupRenderPipeline();
        }
        break;
    }
  }

  private async initWebGPU(canvas: OffscreenCanvas, dpr: number) {
    this.canvas = canvas;
    this.dpr = dpr;

    if (!navigator.gpu) throw new Error('WebGPU not supported');

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No adapter found');
    this.device = await adapter.requestDevice();

    this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
    const format = navigator.gpu.getPreferredCanvasFormat();

    this.context.configure({
      device: this.device,
      format,
      alphaMode: 'premultiplied',
    });

    await this.setupRenderPipeline();
  }

  private async setupRenderPipeline() {
    if (!this.device || !this.context) return;

    // Base vertices for the quad
    const vertices = new Float32Array([
      -0.8,
      -0.8, // Triangle 1
      0.8,
      -0.8,
      0.8,
      0.8,

      -0.8,
      -0.8, // Triangle 2
      0.8,
      0.8,
      -0.8,
      0.8,
    ]);

    this.vertexBuffer = this.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.vertexBuffer, 0, vertices);

    // Create uniform buffer for time
    this.uniformBuffer = this.device.createBuffer({
      size: 4, // One float32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create shader with animation
    const shaderModule = this.device.createShaderModule({
      code: `
        @group(0) @binding(0) var<uniform> time: f32;

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) originalPos: vec2f,
        }

        @vertex
        fn vertexMain(@location(0) position: vec2f) -> VertexOutput {
          var output: VertexOutput;
          
          // Calculate circular motion
          let radius = 0.1;  // Size of the circle
          let freq = 1.0;    // Speed of rotation
          let angle = time * freq;
          
          // Add circular offset to original position
          let offset = vec2f(
            radius * cos(angle + length(position) * 2.0),
            radius * sin(angle + length(position) * 2.0)
          );
          
          let animatedPos = position + offset;
          output.position = vec4f(animatedPos, 0.0, 1.0);
          output.originalPos = position;
          return output;
        }

        @fragment
        fn fragmentMain(@location(0) originalPos: vec2f) -> @location(0) vec4f {
          return vec4f(0.5, 0.7, 1.0, 1.0);
        }
      `,
    });

    // Create bind group layout and bind group
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' },
        },
      ],
    });

    this.bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer },
        },
      ],
    });

    // Create render pipeline
    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: 8, // 2 floats * 4 bytes
            attributes: [
              {
                format: 'float32x2',
                offset: 0,
                shaderLocation: 0,
              },
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [
          {
            format: navigator.gpu.getPreferredCanvasFormat(),
          },
        ],
      },
    });
  }

  private async maybeStartAnimationLoop() {
    if (!this.running || !this.notifySABI32 || !this.frequencyDataSABU8) {
      return;
    }

    const runToken = Math.random() + Math.random() * 10 + Math.random() * 100;
    this.runToken = runToken;

    const hasWaitAsync = typeof Atomics.waitAsync === 'function';
    if (!hasWaitAsync) {
      console.warn(
        'Atomics.waitAsync not available, falling back to less efficient `Atomics.wait`-based implementation'
      );
    }

    const frequencyDataU8 = this.frequencyDataSABU8;

    let lastRenderedFrameIx = -1;

    while (true) {
      if (this.runToken !== runToken) {
        // A new animation loop has started, so stop this one.
        return;
      }

      let res: 'not-equal' | 'timed-out' | 'ok';
      if (hasWaitAsync) {
        res = await Atomics.waitAsync(this.notifySABI32, 0, lastRenderedFrameIx).value;
      } else {
        res = Atomics.wait(this.notifySABI32, 0, lastRenderedFrameIx, 5);
        // yield to allow microtasks to run
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      if (res === 'timed-out') {
        continue;
      }
      lastRenderedFrameIx = Atomics.load(this.notifySABI32, 0);
    }
  }

  private render = () => {
    if (
      !this.device ||
      !this.context ||
      !this.pipeline ||
      !this.vertexBuffer ||
      !this.uniformBuffer ||
      !this.bindGroup
    )
      return;

    // Update time uniform
    const time = new Float32Array([(performance.now() - this.startTime) / 1000]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, time);

    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    renderPass.setVertexBuffer(0, this.vertexBuffer);
    renderPass.draw(6); // 6 vertices for 2 triangles
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  };
}

const worker = new ChiFieldRendererWorker();
self.addEventListener('message', evt => worker.handleMessage(evt));
