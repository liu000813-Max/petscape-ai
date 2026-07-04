import { readFile } from 'fs/promises';

// PLA density fallback. PrusaSlicer profiles may omit filament density, leaving [g]=0.
const PLA_DENSITY_G_PER_CM3 = 1.24;

export interface GcodeMeta {
  estimatedTime?: string;
  weightG?: number;
  printTimeMin?: number;
}

export function parseGcodeMeta(header: string): GcodeMeta {
  const timeMatch = header.match(/(?:estimated printing time[^\n:]*|print time[^\n:]*)\s*[:=]\s*([^\n;]+)/i);
  const filamentG = header.match(/filament used \[g\]\s*=\s*([\d.]+)/i);
  const filamentCm3 = header.match(/filament used \[cm3\]\s*=\s*([\d.]+)/i);
  const estimatedTime = timeMatch?.[1]?.trim();
  const gFromHeader = filamentG ? parseFloat(filamentG[1]) : 0;
  const gFromVolume = filamentCm3 ? parseFloat(filamentCm3[1]) * PLA_DENSITY_G_PER_CM3 : 0;
  const grams = gFromHeader > 0 ? gFromHeader : gFromVolume;
  const weightG = grams > 0 ? Math.round(grams * 10) / 10 : undefined;

  let printTimeMin: number | undefined;
  if (estimatedTime) {
    const d = /(\d+)\s*d/i.exec(estimatedTime);
    const h = /(\d+)\s*h/i.exec(estimatedTime);
    const m = /(\d+)\s*m/i.exec(estimatedTime);
    const s = /(\d+)\s*s/i.exec(estimatedTime);
    const total = (d ? +d[1] * 1440 : 0) + (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) + (s ? +s[1] / 60 : 0);
    if (total > 0) printTimeMin = Math.round(total);
  }

  return { estimatedTime, weightG, printTimeMin };
}

export async function readGcodeMeta(gcodeAbs: string) {
  const buf = await readFile(gcodeAbs, 'utf8');
  return parseGcodeMeta(`${buf.slice(0, 120_000)}\n${buf.slice(-120_000)}`);
}
