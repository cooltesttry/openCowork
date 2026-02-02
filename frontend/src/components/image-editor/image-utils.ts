/**
 * Image optimization utilities for reference images
 *
 * Strategy matches backend image_pipeline/optimizer.py Grid approach:
 * - Outer loop: size from large to small
 * - Inner loop: quality from high to low
 * - Return first result that meets size limit
 * - Preserve alpha channel as PNG, otherwise use JPEG
 */

// Optimization configuration (more aggressive for reference images)
const RESIZE_GRID = [1024, 800, 600, 400];
const QUALITY_GRID = [0.80, 0.65, 0.50, 0.35];
const PNG_QUALITY = 1.0;  // PNG doesn't support quality parameter, relies on size reduction
const MAX_BYTES = 500 * 1024;  // 500KB (reference images don't need 3MB)

/**
 * Check if an image has an alpha channel with actual transparency
 */
function hasAlphaChannel(img: HTMLImageElement, canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Check if any pixel has alpha < 255
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

/**
 * Calculate scaled dimensions while maintaining aspect ratio
 */
function calculateSize(width: number, height: number, maxSide: number): { w: number; h: number } {
  if (Math.max(width, height) <= maxSide) {
    return { w: width, h: height };
  }
  if (width > height) {
    return { w: maxSide, h: Math.round(height * maxSide / width) };
  }
  return { w: Math.round(width * maxSide / height), h: maxSide };
}

/**
 * Estimate actual byte size from a data URL
 */
function estimateBytes(dataUrl: string): number {
  // data URL format: data:image/xxx;base64,XXXXXX
  // base64 encoded size is approximately 4/3 of original
  const base64Part = dataUrl.split(',')[1] || '';
  return Math.round(base64Part.length * 0.75);
}

/**
 * Optimize an image for use as a reference image
 *
 * Strategy: Grid search matching backend approach
 * - Outer: size from large to small
 * - Inner: quality from high to low
 * - Return first result meeting size limit
 * - Preserve alpha channel as PNG, otherwise use JPEG
 */
export async function optimizeImageForReference(
  dataUrl: string,
  maxBytes: number = MAX_BYTES
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const originalBytes = estimateBytes(dataUrl);
      const currentMax = Math.max(img.width, img.height);

      // Build applicable resize grid
      let resizeGrid = RESIZE_GRID.filter(s => s <= currentMax);
      if (currentMax < RESIZE_GRID[0] && !resizeGrid.includes(currentMax)) {
        resizeGrid = [currentMax, ...resizeGrid];
      }
      if (resizeGrid.length === 0) {
        resizeGrid = [currentMax];
      }
      resizeGrid.sort((a, b) => b - a);

      // Create canvas
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;

      // Check for alpha channel at original size
      canvas.width = img.width;
      canvas.height = img.height;
      const preserveAlpha = hasAlphaChannel(img, canvas);

      let bestResult: string | null = null;
      let bestSize = Infinity;

      // Grid search
      for (const side of resizeGrid) {
        const qualityGrid = preserveAlpha ? [PNG_QUALITY] : QUALITY_GRID;

        for (const quality of qualityGrid) {
          const { w, h } = calculateSize(img.width, img.height, side);
          canvas.width = w;
          canvas.height = h;

          // Draw scaled image
          if (preserveAlpha) {
            ctx.clearRect(0, 0, w, h);
          } else {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, w, h);
          }
          ctx.drawImage(img, 0, 0, w, h);

          // Compress
          const format = preserveAlpha ? 'image/png' : 'image/jpeg';
          const result = canvas.toDataURL(format, quality);
          const size = estimateBytes(result);

          // Track smallest result
          if (size < bestSize) {
            bestResult = result;
            bestSize = size;
          }

          // Return first result meeting size constraint
          if (size <= maxBytes) {
            console.log(`[ImageOptimizer] Optimized: ${(originalBytes / 1024).toFixed(1)}KB -> ${(size / 1024).toFixed(1)}KB (${w}x${h}, q=${quality}, ${preserveAlpha ? 'PNG' : 'JPEG'})`);
            resolve(result);
            return;
          }
        }
      }

      // Return smallest result even if over limit
      console.log(`[ImageOptimizer] Best effort: ${(originalBytes / 1024).toFixed(1)}KB -> ${(bestSize / 1024).toFixed(1)}KB (exceeds ${(maxBytes / 1024).toFixed(1)}KB limit)`);
      resolve(bestResult || dataUrl);
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}
