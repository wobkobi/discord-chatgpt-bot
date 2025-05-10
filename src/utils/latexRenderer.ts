/**
 * @file src/utils/latexRenderer.ts
 * @description Provides utilities to render LaTeX expressions to SVG, PNG, and JPG formats using MathJax and Sharp,
 *   with deterministic caching based on content hashes.
 *
 *   Cached outputs are stored under data/output for reuse across process restarts.
 *   Uses debug logging via logger.debug to trace rendering and caching steps.
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

logger.debug("[latexRenderer] Module loaded and MathJax initialised");

/**
 * Ensure the output directory exists, creating it recursively if necessary.
 * @async
 * @returns Promise<void> that resolves once the directory is ensured.
 */
async function ensureOutputDir(): Promise<void> {
  logger.debug(`[latexRenderer] ensureOutputDir invoked for ${OUTPUT_DIR}`);
  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    logger.debug(`[latexRenderer] Output directory ensured: ${OUTPUT_DIR}`);
  } catch (err) {
    logger.error("[latexRenderer] Failed to create output directory:", err);
  }
}

// Initialise output directory on module load
ensureOutputDir();

/**
 * Compute a deterministic cache key for a given LaTeX input by hashing.
 * @param latex - The raw LaTeX string to hash.
 * @returns A 16-character hex string derived from the SHA-256 hash of the input.
 */
function computeKey(latex: string): string {
  const hash = createHash("sha256").update(latex).digest("hex").slice(0, 16);
  logger.debug(
    `[latexRenderer] computeKey for input length=${latex.length}: key=${hash}`
  );
  return hash;
}

/**
 * Render a LaTeX string to an SVG markup fragment.
 * Extracts only the <svg>…</svg> portion from the full MathJax output.
 * @param latex - The LaTeX expression to convert.
 * @returns String containing the SVG XML markup.
 * @throws Error when the MathJax output does not contain valid SVG tags.
 */
function renderLatexToSvgString(latex: string): string {
  logger.debug(
    `[latexRenderer] renderLatexToSvgString invoked for input length=${latex.length}`
  );
  const full = html.convert(latex, { display: true });
  const markup = adaptor.outerHTML(full);
  const start = markup.indexOf("<svg");
  const end = markup.lastIndexOf("</svg>");
  if (start < 0 || end < 0) {
    throw new Error("Invalid SVG output from MathJax");
  }
  const svgFragment = markup.slice(start, end + "</svg>".length);
  logger.debug(
    `[latexRenderer] Extracted SVG fragment length=${svgFragment.length}`
  );
  return svgFragment;
}

/**
 * Render LaTeX to an SVG file on disk, using a cached version if available.
 * @param latexInput - Raw LaTeX string to render.
 * @returns Promise resolving to the absolute path of the generated or cached SVG file.
 */
export async function renderMathToSvg(latexInput: string): Promise<string> {
  const key = computeKey(latexInput);
  const outName = `math-${key}.svg`;
  const outPath = path.join(OUTPUT_DIR, outName);
  logger.debug(`[latexRenderer] renderMathToSvg invoked; outPath=${outPath}`);
  try {
    const stat = await fs.stat(outPath);
    if (stat.isFile()) {
      logger.debug(`[latexRenderer] SVG cache hit for key=${key}`);
      return outPath;
    }
  } catch {
    logger.debug(`[latexRenderer] No cached SVG; generating for key=${key}`);
  }
  const svgString = renderLatexToSvgString(latexInput);
  await fs.writeFile(outPath, svgString, "utf8");
  logger.debug(`[latexRenderer] Wrote SVG to ${outPath}`);
  return outPath;
}

/**
 * Render LaTeX to a PNG buffer and save it on disk, reusing cache when possible.
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
  logger.debug(
    `[latexRenderer] renderMathToPng invoked; svgPath=${svgPath}, outPath=${outPath}`
  );
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(outPath);
    logger.debug(`[latexRenderer] PNG cache hit for key=${key}`);
  } catch {
    logger.debug(`[latexRenderer] No cached PNG; generating for key=${key}`);
    buffer = await sharp(svgPath, { density: 300 })
      .flatten({ background: "#fff" })
      .extend({ top: 20, bottom: 20, left: 20, right: 20, background: "#fff" })
      .png()
      .toBuffer();
    await fs.writeFile(outPath, buffer);
    logger.debug(`[latexRenderer] Wrote PNG to ${outPath}`);
  }
  return { buffer, filePath: outPath };
}

/**
 * Render LaTeX to a JPEG buffer and save it on disk, reusing cache when possible.
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
  logger.debug(
    `[latexRenderer] renderMathToJpg invoked; svgPath=${svgPath}, outPath=${outPath}`
  );
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(outPath);
    logger.debug(`[latexRenderer] JPEG cache hit for key=${key}`);
  } catch {
    logger.debug(`[latexRenderer] No cached JPEG; generating for key=${key}`);
    buffer = await sharp(svgPath)
      .flatten({ background: "#fff" })
      .extend({ top: 20, bottom: 20, left: 20, right: 20, background: "#fff" })
      .jpeg({ quality: 95 })
      .toBuffer();
    await fs.writeFile(outPath, buffer);
    logger.debug(`[latexRenderer] Wrote JPEG to ${outPath}`);
  }
  return { buffer, filePath: outPath };
}
