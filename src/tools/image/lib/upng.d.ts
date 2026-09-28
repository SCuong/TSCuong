declare module 'upng-js' {
  interface DecodedPng {
    width: number;
    height: number;
    depth: number;
    ctype: number;
    frames: Array<{ rect: { x: number; y: number; width: number; height: number }; delay: number }>;
    tabs: Record<string, unknown>;
    data: ArrayBuffer;
  }
  const UPNG: {
    /** `cnum` = 0 for lossless, otherwise the maximum number of palette colors. */
    encode(imgs: ArrayBuffer[], w: number, h: number, cnum: number, dels?: number[]): ArrayBuffer;
    decode(buffer: ArrayBuffer): DecodedPng;
    toRGBA8(img: DecodedPng): ArrayBuffer[];
  };
  export default UPNG;
}
