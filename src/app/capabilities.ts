import type { Capabilities } from '../db/types';

/** WebGL capability check (task 0.1). Stored in settings so the 3D defender knows to fall back. */
export function checkCapabilities(now = new Date()): Capabilities {
  const out: Capabilities = { checkedAt: now.toISOString(), webgl: false, webgl2: false };
  try {
    const c = document.createElement('canvas');
    const gl2 = c.getContext('webgl2');
    const gl = (gl2 ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    out.webgl2 = !!gl2;
    out.webgl = !!gl;
    if (gl) {
      out.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      out.renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    // No canvas or a blocked context: recorded as no WebGL.
  }
  return out;
}
