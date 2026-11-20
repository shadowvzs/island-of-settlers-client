/** Finish startup uploads without blocking the UI thread with gl.finish(). */
export const waitForGpuFrame = async (gl: WebGL2RenderingContext, timeoutMs = 2000) => {
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!fence) return false;
  const deadline = performance.now() + timeoutMs;
  gl.flush();
  try {
    while (!gl.isContextLost()) {
      const status = gl.clientWaitSync(fence, 0, 0);
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) return true;
      if (status === gl.WAIT_FAILED || performance.now() >= deadline) return false;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    return false;
  } finally {
    gl.deleteSync(fence);
  }
};
