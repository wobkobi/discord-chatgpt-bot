import { exec } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Map human-friendly scales to dvisvgm scale factors.
 */
const scaleMap: Record<string, string> = {
  "100%": "1.0",
  "200%": "2.0",
  "300%": "3.0",
  // …extend as needed…
};

/**
 * Generate a .tex file around the given equation.
 */
function getLatexTemplate(equation: string) {
  return `
\\documentclass[preview]{standalone}
\\usepackage{amsmath,amssymb}
\\begin{document}
${equation}
\\end{document}`;
}

/**
 * Run LaTeX → DVI → SVG inside Docker, then convert to PNG via sharp.
 */
export async function renderLatexToPng(
  equation: string,
  outputScale: keyof typeof scaleMap = "100%"
): Promise<Buffer> {
  // 1) create a temp working directory
  const id = Date.now().toString(36);
  const work = join(tmpdir(), id);
  await fs.mkdir(work);
  await fs.writeFile(join(work, "eq.tex"), getLatexTemplate(equation));

  // 2) run Dockerized LaTeX → .svg
  const scale = scaleMap[outputScale];
  const dockerCmd = `
    cd ${work} &&
    docker run --rm -v "$PWD":/data -w /data blang/latex:ubuntu \
      /bin/bash -lc "\
        latex -interaction=nonstopmode eq.tex && \
        dvisvgm --no-fonts --scale=${scale} eq.dvi"
  `;
  await execAsync(dockerCmd, { timeout: 30_000 });

  // 3) read the generated SVG
  const svgPath = join(work, "eq.svg");
  const svg = await fs.readFile(svgPath);

  // 4) convert SVG → PNG (sharp preserves size automatically)
  const sharp = await import("sharp");
  const pngBuffer = await sharp.default(svg).png().toBuffer();

  // 5) clean up
  await fs.rm(work, { recursive: true, force: true });
  return pngBuffer;
}
