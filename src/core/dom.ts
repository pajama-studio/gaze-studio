import type { AOI, Recording } from "./types";
import { PALETTE } from "./types";
// A separate adapter from visual detection: explicit recorded DOM boxes, not semantic guesses.
export function gazeMiningLayers(
  data: { Layers: Record<string, unknown>[] },
  r: Recording,
): AOI[] {
  if (!Array.isArray(data.Layers))
    throw new Error("No recorded DOM layers found in this source.");
  const output: AOI[] = [];
  for (const layer of [...data.Layers].sort(
    (a, b) => Number(a.qtVideoTs_first) - Number(b.qtVideoTs_first),
  )) {
    if (layer.type !== "fixed") continue;
    const { x, y, width, height } = layer;
    if (
      ![x, y, width, height].every(
        (v) => typeof v === "number" && Number.isFinite(v),
      )
    )
      continue;
    const left = Math.max(0, Number(x)),
      top = Math.max(0, Number(y)),
      right = Math.min(r.width, Number(x) + Number(width)),
      bottom = Math.min(r.height, Number(y) + Number(height));
    const start = Math.max(0, Math.round(Number(layer.qtVideoTs_first) * 1000)),
      end = Math.min(
        r.duration,
        Math.round(Number(layer.qtVideoTs_last) * 1000) + 50000,
      );
    if (right - left < 10 || bottom - top < 10 || end <= start) continue;
    const xpath = String(layer.xpath),
      name =
        xpath.split("/").at(-1)?.replace(/^div-/, "") ?? "Fixed page element";
    // Keep visibility episodes separate. Do not interpolate through scrolling/navigation gaps.
    output.push({
      id: `dom-${output.length}-${start}`,
      name: `DOM · ${name}`,
      shape: "rectangle",
      color: PALETTE[output.length % PALETTE.length],
      start,
      end,
      keyframes: [
        {
          t: start,
          points: [
            [left, top],
            [right, bottom],
          ],
        },
      ],
      source: "import",
      model: `recorded-dom:${xpath}`,
      accepted: false,
    });
  }
  return output;
}
export interface DOMCapture {
  t_us: number;
  width: number;
  height: number;
  elements: {
    id: string;
    role: string;
    label: string;
    box: [number, number, number, number];
  }[];
}
/** Call in a same-origin stimulus page. Attach captures to the same performance clock as gaze. */
export function captureDOM(
  origin: number,
  selectors = "button,a,input,video,img,[data-aoi]",
): DOMCapture {
  return {
    t_us: Math.round((performance.now() - origin) * 1000),
    width: innerWidth,
    height: innerHeight,
    elements: [...document.querySelectorAll<HTMLElement>(selectors)].flatMap(
      (element, i) => {
        const b = element.getBoundingClientRect(),
          style = getComputedStyle(element);
        if (
          !b.width ||
          !b.height ||
          style.visibility === "hidden" ||
          style.display === "none" ||
          Number(style.opacity) === 0 ||
          b.right < 0 ||
          b.bottom < 0 ||
          b.left >= innerWidth ||
          b.top >= innerHeight
        )
          return [];
        return [
          {
            id: element.dataset.aoi || element.id || `element-${i}`,
            role: element.getAttribute("role") || element.tagName.toLowerCase(),
            label: (
              element.getAttribute("aria-label") ||
              element.getAttribute("alt") ||
              element.textContent ||
              ""
            )
              .trim()
              .slice(0, 100),
            box: [b.left, b.top, b.right, b.bottom] as [
              number,
              number,
              number,
              number,
            ],
          },
        ];
      },
    ),
  };
}
