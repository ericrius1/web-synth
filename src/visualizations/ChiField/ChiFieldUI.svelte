<script lang="ts">
    import { onDestroy, onMount } from 'svelte';

    const dpr = Math.floor(window.devicePixelRatio || 1);
    let windowWidth = 100;
    let windowHeight = 100;
    $: width = (() => {
      const baseWidth = Math.floor(windowWidth * 0.75);
      const remainder = baseWidth % dpr;
      return baseWidth - remainder;
    })();
    $: height = (() => {
      const baseHeight = Math.max(Math.floor(windowHeight - 122 - 82 - 340), 350);
      const remainder = baseHeight % dpr;
      return baseHeight - remainder;
    })();
  
    let container: HTMLDivElement | null = null;
    let canvas: HTMLCanvasElement;
    let worker: Worker;

    const initRenderer = async () => {
      worker = new Worker(new URL('./ChiFieldRenderer.worker.ts', import.meta.url));
      const offscreenCanvas = canvas.transferControlToOffscreen();
      worker.postMessage({ 
        type: 'init',
        canvas: offscreenCanvas,
        dpr
      }, [offscreenCanvas]);
    };

    $: if (width && height && worker) {
      worker.postMessage({
        type: 'resize',
        width: width * dpr,
        height: height * dpr
      });
    }

    onMount(async () => {
      await initRenderer();
    });

    onDestroy(() => {
      worker?.terminate();
    });

    const handleMouseMove = (e: MouseEvent) => {
      const { x, y } = e;
      const { left, top } = container!.getBoundingClientRect();
      const canvasX = x - left;
      // Handle mouse movement
    };
  
    const handleMouseLeave = () => {
      // Handle mouse leave
    };
  </script>
  
  <svelte:window bind:innerWidth={windowWidth} bind:innerHeight={windowHeight} />
  <div bind:this={container} class="container">
    <canvas
      bind:this={canvas}
      width={width * dpr}
      height={height * dpr}
      style="width: {width}px; height: {height}px;"
      on:mousemove={handleMouseMove}
      on:mouseleave={handleMouseLeave}
    />
  </div>
  
  <style lang="css">
    .container {
      width: 100%;
      height: 100%;
      position: relative;
      margin-left: 30px;
      margin-top: 8px;
      margin-bottom: 16px;
    }
  </style>