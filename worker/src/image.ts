// Pixel size of a PNG or JPEG from its header, and whether a PNG carries transparency.
export interface ImageInfo {
  type: "png" | "jpeg";
  width: number;
  height: number;
  alpha: boolean;
}

export function imageInfo(bytes: Uint8Array): ImageInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 26 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && view.getUint32(12) === 0x49484452) {
    const colourType = bytes[25];
    return { type: "png", width: view.getUint32(16), height: view.getUint32(20), alpha: colourType === 4 || colourType === 6 };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1];
      if (marker === 0xff) {
        at++;
        continue;
      }
      const length = view.getUint16(at + 2);
      // Start-of-frame markers carry the size; 0xC4, 0xC8 and 0xCC share the range but are not frames.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: "jpeg", width: view.getUint16(at + 7), height: view.getUint16(at + 5), alpha: false };
      }
      at += 2 + length;
    }
  }
  return null;
}
