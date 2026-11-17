// "Will it fit?" is arithmetic, so the server does it. A model should never be trusted to subtract.

import { spec, type Product } from "./catalog.ts";

export interface FitResult {
  fits: boolean;
  /** Space left over on each side combined, in cm. Negative when it does not fit. */
  spareCm: number;
  widthCm: number;
}

/** A product fits a gap when there is at least `clearanceCm` to spare, so doors and vents can breathe. */
export function willItFit(product: Product, gapCm: number, clearanceCm = 2): FitResult {
  const width = spec(product, "Width");
  if (!width) throw new Error(`${product.id} has no width on its spec sheet`);
  const spareCm = Math.round((gapCm - width.value) * 10) / 10;
  return { fits: spareCm >= clearanceCm, spareCm, widthCm: width.value };
}

/** Pull a gap width out of a question such as "will it fit in a 90 cm space?". */
export function gapFromQuestion(question: string): number | undefined {
  const match = question.match(/(\d+(?:[.,]\d+)?)\s*(?:cm|centimetres?|centimeters?)/i);
  return match ? Number(match[1]!.replace(",", ".")) : undefined;
}
