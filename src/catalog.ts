// A small, made-up catalogue. In a real deployment this comes from the product team's spec sheets,
// and the spec sheet is the only source of truth: if a fact is not here, the assistant may not say it.

export interface Spec {
  label: string;
  value: number;
  unit: Unit;
}

export type Unit = "l" | "kg" | "cm" | "db" | "kwh" | "year" | "minute" | "star" | "inch" | "w";

export interface Product {
  id: string;
  name: string;
  category: "refrigerator" | "washer" | "dryer";
  specs: Spec[];
  features: string[];
}

export const catalog: Product[] = [
  {
    id: "fridge-650",
    name: "French-door refrigerator, 650 L",
    category: "refrigerator",
    specs: [
      { label: "Capacity", value: 650, unit: "l" },
      { label: "Width", value: 91.2, unit: "cm" },
      { label: "Height", value: 178, unit: "cm" },
      { label: "Depth", value: 72.3, unit: "cm" },
      { label: "Energy use", value: 540, unit: "kwh" },
      { label: "Noise", value: 39, unit: "db" },
      { label: "Warranty", value: 1, unit: "year" },
    ],
    features: ["water dispenser", "twin cooling", "door alarm"],
  },
  {
    id: "fridge-580",
    name: "Top-mount refrigerator, 580 L",
    category: "refrigerator",
    specs: [
      { label: "Capacity", value: 580, unit: "l" },
      { label: "Width", value: 83.6, unit: "cm" },
      { label: "Height", value: 186.2, unit: "cm" },
      { label: "Depth", value: 78.8, unit: "cm" },
      { label: "Energy use", value: 420, unit: "kwh" },
      { label: "Noise", value: 39, unit: "db" },
      { label: "Warranty", value: 1, unit: "year" },
    ],
    features: ["twin cooling", "inverter compressor", "LED lighting"],
  },
  {
    id: "washer-11",
    name: "Front-load washer, 11 kg",
    category: "washer",
    specs: [
      { label: "Capacity", value: 11, unit: "kg" },
      { label: "Width", value: 60, unit: "cm" },
      { label: "Height", value: 85, unit: "cm" },
      { label: "Depth", value: 60, unit: "cm" },
      { label: "Quick wash", value: 15, unit: "minute" },
      { label: "Noise", value: 53, unit: "db" },
      { label: "Warranty", value: 2, unit: "year" },
    ],
    features: ["quick wash", "steam cycle", "auto detergent dosing"],
  },
];

export function findProduct(id: string, products: Product[] = catalog): Product | undefined {
  return products.find((p) => p.id === id);
}

export function spec(product: Product, label: string): Spec | undefined {
  return product.specs.find((s) => s.label.toLowerCase() === label.toLowerCase());
}
