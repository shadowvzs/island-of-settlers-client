import type { BufferAttribute, InterleavedBufferAttribute, WebGPURenderer } from "three/webgpu";

interface AttributeBackend {
  delete: (object: object) => void;
  destroyAttribute: (attribute: BufferAttribute | InterleavedBufferAttribute) => void;
  get: (object: object) => { buffer?: GPUBuffer };
  isWebGPUBackend?: boolean;
}

const isInterleaved = (attribute: BufferAttribute | InterleavedBufferAttribute):
  attribute is InterleavedBufferAttribute =>
  (attribute as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute === true;

/**
 * C-1 (plant casters): Three r186 releases an interleaved attribute by destroying the GPU buffer
 * stored on its `InterleavedBuffer` but deletes only the view's own backend record. The buffer's
 * record keeps the destroyed `GPUBuffer`; the next upload of any view reuses it and every later
 * draw binds it ("Buffer used in submit while destroyed", then a lost device). A geometry dispose
 * deletes the node attributes of the render object that first drew it: disposing the prop FPS
 * caster's geometry released the packed prop vertex buffer and instance matrix the colour mesh
 * shares. This drops the buffer's record with the buffer, so the next draw re-creates and fully
 * uploads it. Views of one buffer are released together (a geometry or a node attribute set),
 * and the first view drawn again re-creates the shared buffer for its siblings. The WebGL2 backend
 * already drops the buffer's record.
 */
export const releaseInterleavedAttributesWithBuffer = (renderer: WebGPURenderer) => {
  const backend = renderer.backend as unknown as AttributeBackend;
  if (backend.isWebGPUBackend !== true) return;
  const destroyAttribute = backend.destroyAttribute.bind(backend);
  backend.destroyAttribute = attribute => {
    if (!isInterleaved(attribute)) {
      destroyAttribute(attribute);
      return;
    }
    // Several views of one buffer may be released in a row: only the first finds the buffer.
    backend.get(attribute.data).buffer?.destroy();
    backend.delete(attribute.data);
    backend.delete(attribute);
  };
};
