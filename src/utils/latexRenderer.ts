/**
 * @file src/utils/latexRenderer.ts
 * @description Provides utilities to render LaTeX expressions to SVG, PNG, and JPG formats using MathJax and Sharp,
 *   with deterministic caching based on content hashes.
 * @remarks
 *   Cached outputs are stored under data/output for reuse across process restarts.
 */

import { createHash } from "crypto";
import { promises as fs } from "fs";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import path from "path";
import sharp from "sharp";
import { OUTPUT_DIR } from "../config/paths.js";
import logger from "./logger.js";

// Initialise MathJax for server-side SVG generation
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const tex = new TeX();
const svgJax = new SVG({ fontCache: "none" });
const html = mathjax.document("", { InputJax: tex, OutputJax: svgJax });

/**
 * Ensure the output directory exists, creating it recursively if necessary.
 *
 * @async
 * @returns Promise that resolves once the directory is ensured.
 */
async function ensureOutputDir(): Promise<void> {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}
// Initialise output directory on module load
ensureOutputDir().catch((err) =>
  logger.error("Failed to create LaTeX output directory:", err)
);

/**
 * Compute a deterministic cache key for a given LaTeX input by hashing.
 *
 * @param latex - The raw LaTeX string to hash.
 * @returns A 16-character hex string derived from the SHA-256 hash of the input.
 */
function computeKey(latex: string): string {
  return createHash("sha256").update(latex).digest("hex").slice(0, 16);
}

/**
 * Render a LaTeX string to an SVG markup fragment.
 * Extracts only the <svg>…</svg> portion from the full MathJax output.
 *
 * @param latex - The LaTeX expression to convert.
 * @throws Error when the MathJax output does not contain valid SVG tags.
 * @returns A string containing the SVG XML markup.
 */
function renderLatexToSvgString(latex: string): string {
  const full = html.convert(latex, { display: true });
  const markup = adaptor.outerHTML(full);
  const start = markup.indexOf("<svg");
  const end = markup.lastIndexOf("</svg>");
  if (start < 0 || end < 0) {
    throw new Error("Invalid SVG output from MathJax");
  }
  return markup.slice(start, end + "</svg>".length);
}

/**
 * Render LaTeX to an SVG file on disk, using cached version if available.
 *
 * @param latexInput - Raw LaTeX string to render.
 * @returns Promise resolving to the absolute path of the generated or cached SVG file.
 */
export async function renderMathToSvg(latexInput: string): Promise<string> {
  const key = computeKey(latexInput);
  const outName = `math-${key}.svg`;
  const outPath = path.join(OUTPUT_DIR, outName);
  try {
    const stat = await fs.stat(outPath);
    if (stat.isFile()) {
      return outPath;
    }
  } catch {
    // File does not exist; proceed to generate
  }
  const svgString = renderLatexToSvgString(latexInput);
  await fs.writeFile(outPath, svgString, "utf8");
  return outPath;
}

/**
 * Render LaTeX to a PNG buffer and save it on disk, reusing cache when possible.
 *
 * @param latexInput - Raw LaTeX string to render.
 * @returns Promise resolving to an object containing the PNG buffer and its file path.
 */
export async function renderMathToPng(
  latexInput: string
): Promise<{ buffer: Buffer; filePath: string }> {
  const svgPath = await renderMathToSvg(latexInput);
  const key = path.basename(svgPath, ".svg");
  const outName = `math-${key}.png`;
  const outPath = path.join(OUTPUT_DIR, outName);
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(outPath);
  } catch {
    // Generate PNG from SVG
    buffer = await sharp(svgPath, { density: 300 })
      .flatten({ background: "#fff" })
      .extend({ top: 20, bottom: 20, left: 20, right: 20, background: "#fff" })
      .png()
      .toBuffer();
    await fs.writeFile(outPath, buffer);
  }
  return { buffer, filePath: outPath };
}

/**
 * Render LaTeX to a JPEG buffer and save it on disk, reusing cache when possible.
 *
 * @param latexInput - Raw LaTeX string to render.
 * @returns Promise resolving to an object containing the JPEG buffer and its file path.
 */
export async function renderMathToJpg(
  latexInput: string
): Promise<{ buffer: Buffer; filePath: string }> {
  const svgPath = await renderMathToSvg(latexInput);
  const key = path.basename(svgPath, ".svg");
  const outName = `math-${key}.jpg`;
  const outPath = path.join(OUTPUT_DIR, outName);
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(outPath);
  } catch {
    // Generate JPEG from SVG
    buffer = await sharp(svgPath)
      .flatten({ background: "#fff" })
      .extend({ top: 20, bottom: 20, left: 20, right: 20, background: "#fff" })
      .jpeg({ quality: 95 })
      .toBuffer();
    await fs.writeFile(outPath, buffer);
  }
  return { buffer, filePath: outPath };
}
