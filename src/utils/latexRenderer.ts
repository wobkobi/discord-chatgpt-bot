/**
 * @file src/utils/latexRenderer.ts
 * @description Renders LaTeX expressions to SVG/PNG using MathJax and Sharp,
 *   with deterministic disk caching based on content hashes.
 */

import { OUTPUT_DIR } from "@/config/paths.js";
import logger from "@/utils/logger.js";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import path from "path";
import sharp from "sharp";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const tex = new TeX();
const svgJax = new SVG({ fontCache: "none" });
const html = mathjax.document("", { InputJax: tex, OutputJax: svgJax });

fs.mkdir(OUTPUT_DIR, { recursive: true }).catch((err) => {
  logger.error("[latexRenderer] Failed to create output directory:", err);
});

/**
 * Compute a deterministic 16-char cache key for a LaTeX string.
 * @param latex - The raw LaTeX string to hash.
 * @returns A 16-character hex string derived from the SHA-256 hash of the input.
 */
function computeKey(latex: string): string {
  return createHash("sha256").update(latex).digest("hex").slice(0, 16);
}

/**
 * Render a LaTeX string to an SVG markup fragment.
 * @param latex - The LaTeX expression to convert.
 * @returns String containing the SVG XML markup.
 * @throws {Error} When the MathJax output does not contain valid SVG tags.
 */
function renderLatexToSvgString(latex: string): string {
  const full = html.convert(latex, { display: true });
  const markup = adaptor.outerHTML(full);
  const start = markup.indexOf("<svg");
  const end = markup.lastIndexOf("</svg>");
  if (start < 0 || end < 0) throw new Error("Invalid SVG output from MathJax");
  return markup.slice(start, end + "</svg>".length);
}

/**
 * Render LaTeX to an SVG file on disk, using a cached version if available.
 * @param latexInput - Raw LaTeX string to render.
 * @returns Promise resolving to the absolute path of the generated or cached SVG file.
 */
async function renderMathToSvg(latexInput: string): Promise<string> {
  const key = computeKey(latexInput);
  const outPath = path.join(OUTPUT_DIR, `math-${key}.svg`);
  try {
    if ((await fs.stat(outPath)).isFile()) return outPath;
  } catch {
    // Cache miss; fall through to render
  }
  const svgString = renderLatexToSvgString(latexInput);
  await fs.writeFile(outPath, svgString, "utf8");
  return outPath;
}

/**
 * Render LaTeX to a PNG buffer and save it on disk, reusing cache when possible.
 * @param latexInput - Raw LaTeX string to render.
 * @returns Promise resolving to an object containing the PNG buffer and its file path.
 */
export async function renderMathToPng(
  latexInput: string,
): Promise<{ buffer: Buffer; filePath: string }> {
  const svgPath = await renderMathToSvg(latexInput);
  const key = path.basename(svgPath, ".svg");
  const outPath = path.join(OUTPUT_DIR, `math-${key}.png`);
  try {
    return { buffer: await fs.readFile(outPath), filePath: outPath };
  } catch {
    // Cache miss; render
  }
  const buffer = await sharp(svgPath, { density: 300 })
    .flatten({ background: "#fff" })
    .extend({ top: 20, bottom: 20, left: 20, right: 20, background: "#fff" })
    .png()
    .toBuffer();
  await fs.writeFile(outPath, buffer);
  return { buffer, filePath: outPath };
}
