import { type Color } from "@tremor/react";

// Stable, deterministic palette of tremor categorical colors used across the
// dashboard charts. Order is fixed so a given set of category labels always
// maps to the same colors between renders and between sibling charts.
const categoricalColors: Color[] = [
  "indigo",
  "cyan",
  "amber",
  "emerald",
  "rose",
  "violet",
  "lime",
  "sky",
  "orange",
  "teal",
  "fuchsia",
  "blue",
  "green",
  "red",
  "purple",
  "pink",
  "yellow",
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
];

/**
 * Maps an ordered list of category labels to a stable list of tremor colors.
 * The i-th category receives the i-th palette color, wrapping around when there
 * are more categories than palette entries. The returned array lines up
 * 1:1 with the input categories so it can be passed straight to a tremor
 * chart's `colors` prop alongside the same category list.
 */
export const getColorsForCategories = (categories: string[]): Color[] =>
  categories.map(
    (_, index) => categoricalColors[index % categoricalColors.length] as Color,
  );

/**
 * Returns a single color from the categorical palette. Used as a fallback fill
 * (e.g. tooltip swatches) when tremor does not supply a series color.
 */
export const getRandomColor = (): Color =>
  categoricalColors[
    Math.floor(Math.random() * categoricalColors.length)
  ] as Color;
