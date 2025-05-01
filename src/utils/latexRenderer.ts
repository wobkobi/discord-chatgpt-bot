import { createHash } from "crypto";
import { promises as fs } from "fs";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";

// ESM __dirname shim
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set up MathJax for server-side SVG generation
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const tex = new TeX();
const svgJax = new SVG({ fontCache: "none" });
const html = mathjax.document("", { InputJax: tex, OutputJax: svgJax });

// Output directory inside container
const OUTPUT_DIR = path.resolve(__dirname, "../../data/output");

// Ensure output directory exists
async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}
ensureOutputDir().catch(console.error);

/**
 * Compute a deterministic cache key for a LaTeX input.
 */
function computeKey(latex: string): string {
  return createHash("sha256").update(latex).digest("hex").slice(0, 16);
}

/**
 * Convert LaTeX to SVG markup string.
 * Extract only the <svg>…</svg> fragment.
 */
function renderLatexToSvgString(latex: string): string {
  const full = html.convert(latex, { display: true });
  const markup = adaptor.outerHTML(full);
  const start = markup.indexOf("<svg");
  const end = markup.lastIndexOf("</svg>");
  if (start < 0 || end < 0) throw new Error("Invalid SVG from MathJax");
  return markup.slice(start, end + "</svg>".length);
}

/**
 * Render LaTeX to SVG file, with caching by content hash.
 * @param latexInput Raw LaTeX string
 * @returns Absolute path to generated or cached SVG
 */
export async function renderMathToSvg(latexInput: string): Promise<string> {
  const key = computeKey(latexInput);
  const outName = `math-${key}.svg`;
  const outPath = path.join(OUTPUT_DIR, outName);
  // reuse if exists
  try {
    const stat = await fs.stat(outPath);
    if (stat.isFile()) return outPath;
  } catch {
    // not exists, will generate
  }
  const svgString = renderLatexToSvgString(latexInput);
  await fs.writeFile(outPath, svgString, "utf8");
  return outPath;
}

/**
 * Render LaTeX to PNG buffer and cached file.
 * @param latexInput Raw LaTeX string
 */
export async function renderMathToPng(
  latexInput: string
): Promise<{ buffer: Buffer; filePath: string }> {
  const svgPath = await renderMathToSvg(latexInput);
  const key = path.basename(svgPath, ".svg");
  const outName = `math-${key}.png`;
  const outPath = path.join(OUTPUT_DIR, outName);
  // reuse if exists
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(outPath);
  } catch {
    // generate new
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
 * Render LaTeX to JPEG buffer and cached file.
 * @param latexInput Raw LaTeX string
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
    buffer = await sharp(svgPath)
      .flatten({ background: "#fff" })
      .jpeg({ quality: 95 })
      .toBuffer();
    await fs.writeFile(outPath, buffer);
  }
  return { buffer, filePath: outPath };
}
