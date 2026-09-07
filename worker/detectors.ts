export const DETR_MODEL = "@cf/facebook/detr-resnet-50" as const;
export interface ObjectDetection {
  label: string;
  score: number;
  box: { xmin: number; ymin: number; xmax: number; ymax: number };
}
/** Backend provider contract. Detectors return image-pixel geometry, independent of Studio's storage and replay components. */
export interface AOIDetector {
  readonly model: string;
  detect(image: Uint8Array): Promise<ObjectDetection[]>;
}
export class WorkersAIDetector implements AOIDetector {
  readonly model = DETR_MODEL;
  constructor(private ai: Ai) {}
  async detect(image: Uint8Array): Promise<ObjectDetection[]> {
    const result = await this.ai.run(DETR_MODEL, { image: [...image] });
    if (!Array.isArray(result)) throw new Error("Unexpected detector output");
    return result.filter(
      (d: any) =>
        d.box &&
        typeof d.label === "string" &&
        Number.isFinite(d.score) &&
        [d.box.xmin, d.box.ymin, d.box.xmax, d.box.ymax].every(Number.isFinite),
    ) as ObjectDetection[];
  }
}
