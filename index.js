import * as fs from 'fs';
import 'ag-psd/initialize-canvas.js';
import { readPsd, writePsdBuffer } from 'ag-psd';
import { createCanvas, loadImage, registerFont } from 'canvas';
import path from 'path';

// Constants
const BLEND_MODE_MAP = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
};

// Utility Functions
const convertBlendMode = (psdBlendMode) => BLEND_MODE_MAP[psdBlendMode] || 'source-over';

const getFontPath = (fontFamily) => {
  const fontPaths = {
    win32: path.join('C:', 'Windows', 'Fonts', `${fontFamily}.ttf`),
    darwin: path.join('/Library/Fonts', `${fontFamily}.ttf`),
    linux: path.join('/usr/share/fonts', `${fontFamily}.ttf`),
  };
  return fontPaths[process.platform] || fontPaths.linux;
};

// Canvas Updates
const drawLayerContent = (layer, ctx) => {
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = convertBlendMode(layer.blendMode);

  if (layer.needDraw && layer.text) {
    const { style, text, transform, paragraphStyle } = layer.text;
    const fontFamily = style.font.name;

    try {
      registerFont(getFontPath(fontFamily), { family: fontFamily });
    } catch (error) {
      console.warn(`Font registration failed for ${fontFamily}: ${error.message}`);
    }

    const fontCanvas = createCanvas(layer.canvas.width, layer.canvas.height);
    const fontCtx = fontCanvas.getContext('2d');

    fontCtx.font = `${style.fontSize}px '${fontFamily}', Arial, sans-serif`;
    fontCtx.fillStyle = `rgba(${style.fillColor?.r || 0}, ${style.fillColor?.g || 0}, 
      ${style.fillColor?.b || 0}, ${style.fillColor?.a || 1})`;
    fontCtx.textAlign = style.alignment || 'center';
    fontCtx.textBaseline = 'top';

    const lines = text.split('\n');
    const lineHeight = transform
      ? (Math.abs(transform[5] - transform[3]) / lines.length) * (paragraphStyle?.autoLeading || 1.2)
      : style.fontSize * (paragraphStyle?.autoLeading || 1.2);

    lines.forEach((line, index) => {
      const x =
        {
          center: layer.canvas.width / 2,
          right: layer.canvas.width,
          left: 0,
        }[fontCtx.textAlign] || 0;
      fontCtx.fillText(line, x, lineHeight * index);
    });

    layer.canvas = fontCanvas;
    fs.writeFileSync(`${layer.name}_fontCanvas.png`, fontCanvas.toBuffer());
  }

  if (layer.canvas) {
    ctx.drawImage(layer.canvas, layer.left, layer.top);
  }

  if (layer.effects?.stroke) {
    const { stroke } = layer.effects;
    ctx.strokeStyle = `rgba(${stroke.color.r}, ${stroke.color.g}, ${stroke.color.b}, ${stroke.opacity})`;
    ctx.lineWidth = stroke.size;

    ctx.save();
    const offset =
      {
        outside: stroke.size / 2,
        inside: -stroke.size / 2,
        center: 0,
      }[stroke.position] || 0;

    ctx.strokeRect(layer.left + offset, layer.top + offset, layer.canvas.width - offset * 2, layer.canvas.height - offset * 2);
    ctx.restore();
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
};

const updatePSDCanvas = (psd) => {
  const mainCanvas = createCanvas(psd.width, psd.height);
  const mainCtx = mainCanvas.getContext('2d');

  const drawLayer = (layer) => {
    if (!layer || layer.hidden) return;

    if (layer.children) {
      const { regularLayers, clippingGroups } = layer.children.reduce(
        (acc, child) => {
          if (child.clipping) {
            acc.currentBase && acc.clippingGroups.set(acc.currentBase, [...(acc.clippingGroups.get(acc.currentBase) || []), child]);
          } else {
            acc.currentBase = child;
            acc.regularLayers.push(child);
          }
          return acc;
        },
        { regularLayers: [], clippingGroups: new Map(), currentBase: null }
      );

      regularLayers.forEach((layer) => {
        if (layer.hidden) return;
        if (layer.canvas) {
          drawLayerContent(layer, mainCtx);
        } else if (layer.children) {
          drawLayer(layer);
        }

        const clippingLayers = clippingGroups.get(layer);
        if (clippingLayers?.length) {
          const tempCanvas = createCanvas(psd.width, psd.height);
          const tempCtx = tempCanvas.getContext('2d');

          tempCtx.drawImage(layer.canvas, layer.left, layer.top);
          tempCtx.globalCompositeOperation = 'source-in';

          clippingLayers.forEach((clipLayer) => {
            if (clipLayer.canvas) {
              tempCtx.globalAlpha = clipLayer.opacity;
              tempCtx.drawImage(clipLayer.canvas, clipLayer.left, clipLayer.top);
            }
          });

          mainCtx.drawImage(tempCanvas, 0, 0);
        }
      });
    } else if (layer.canvas && !layer.clipping) {
      drawLayerContent(layer, mainCtx);
    }
  };
  drawLayer(psd);
  psd.canvas = mainCanvas;
  return mainCanvas;
};

const updatePSDLinkId = (psd, linkId, imageIns) => {
  if (!psd) return;

  if (psd.placedLayer?.id === linkId) {
    psd.placedLayer.needDraw = true;
    const { transform } = psd.placedLayer;
    const [width, height] = [transform[2] - transform[0], transform[5] - transform[3]];

    const newCanvas = createCanvas(width, height);
    newCanvas.getContext('2d').drawImage(imageIns, 0, 0, width, height);
    psd.canvas = newCanvas;
  }

  psd.children?.forEach((child) => updatePSDLinkId(child, linkId, imageIns));
};

// Main Function
const main = async (psdPath, layerName, base64Image) => {
  try {
    if (!psdPath || !layerName || !base64Image) {
      throw new Error('Missing required parameters');
    }

    const buffer = fs.readFileSync(psdPath);
    const psd = readPsd(buffer);

    const findLayer = (layers, name) => {
      for (const layer of layers || []) {
        if (layer.name === name) return layer;
        if (layer.children) {
          const found = findLayer(layer.children, name);
          if (found) return found;
        }
      }
    };

    const replaceLayer = findLayer(psd.children, layerName);
    if (!replaceLayer) {
      throw new Error(`Layer "${layerName}" not found`);
    }

    const newImage = await loadImage(Buffer.from(base64Image, 'base64'));
    const canvas = createCanvas(newImage.width, newImage.height);
    canvas.getContext('2d').drawImage(newImage, 0, 0);

    if (replaceLayer.placedLayer) {
      const linkId = replaceLayer.placedLayer.id;
      const linkedFile = psd.linkedFiles?.find((file) => file.id === linkId);
      if (linkedFile) {
        linkedFile.data = canvas.toBuffer();
      }
      updatePSDLinkId(psd, linkId, newImage);
    } else {
      replaceLayer.canvas = canvas;
    }

    updatePSDCanvas(psd);
    const psdBuffer = writePsdBuffer(psd);
    const outputBuffer = psd.canvas.toBuffer();
    return {
      buffer: outputBuffer.toString('base64'),
      psd: psdBuffer.toString('base64'),
    };
  } catch (error) {
    console.error(`Error processing PSD: ${error.message}`);
    throw error;
  }
};

// Handle stdin input
if (process.argv[2] === '--pipe') {
  let inputData = '';

  process.stdin
    .setEncoding('utf8')
    .on('data', (chunk) => {
      inputData += chunk;
    })
    .on('end', async () => {
      try {
        const { psdPath, layerName, base64Image } = JSON.parse(inputData);
        const result = await main(psdPath, layerName, base64Image);
        process.stdout.write(JSON.stringify({ success: true, data: result }));
      } catch (error) {
        throw new Error(
          JSON.stringify({
            success: false,
            error: String(error),
          })
        );
      }
    });
}

export { main };
