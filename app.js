const fileInput = document.getElementById('fileInput');
const maxDimensionInput = document.getElementById('maxDimension');
const baseNameInput = document.getElementById('baseName');
const startIndexInput = document.getElementById('startIndex');
const downloadButton = document.getElementById('downloadAll');
const imagesContainer = document.getElementById('imagesContainer');
const imageTemplate = document.getElementById('imageTemplate');
const thresholdInput = document.getElementById('whiteThreshold');
const matchFirstCropCheckbox = document.getElementById('matchFirstCrop');

const MIN_CROP_PIXELS = 1;
const DEFAULT_WHITE_THRESHOLD = 252;
const WHITE_THRESHOLD_MIN = 200;
const WHITE_THRESHOLD_MAX = 254;
const WHITE_ROW_TOLERANCE = 0.995;
const DOWNLOAD_DELAY_MS = 180;

const state = {
  items: [],
  whiteThreshold: DEFAULT_WHITE_THRESHOLD,
  applyFirstCrop: false,
};

if (thresholdInput) {
  const initial = sanitizeWhiteThreshold(thresholdInput.value);
  state.whiteThreshold = initial;
  thresholdInput.value = String(initial);
}

fileInput.addEventListener('change', (event) => {
  const files = Array.from(event.target.files || []);
  files.forEach((file) => {
    if (!file.type.startsWith('image/')) {
      return;
    }
    loadImageFile(file);
  });
  fileInput.value = '';
});

downloadButton.addEventListener('click', handleDownloadAll);

if (thresholdInput) {
  const handle = () => {
    const newValue = sanitizeWhiteThreshold(thresholdInput.value);
    state.whiteThreshold = newValue;
    thresholdInput.value = String(newValue);
    recomputeAutoOffsets();
  };
  thresholdInput.addEventListener('input', handle);
  thresholdInput.addEventListener('change', handle);
}

if (matchFirstCropCheckbox) {
  matchFirstCropCheckbox.addEventListener('change', () => {
    state.applyFirstCrop = matchFirstCropCheckbox.checked;
    if (state.applyFirstCrop) {
      applyReferenceCrop();
    } else {
      state.items.forEach((item) => {
        if (!item.isManual) {
          item.offsets = { ...item.autoOffsets };
        }
        updateSliderUI(item);
        updatePreview(item);
      });
    }
  });
}

function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const autoOffsets = detectAutoOffsets(img);
      const item = {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        file,
        image: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        autoOffsets: { ...autoOffsets },
        offsets: { ...autoOffsets },
        isManual: false,
      };

      createImageCard(item);
      state.items.push(item);
      updateDownloadButtonState();
      updatePreview(item);

      if (state.applyFirstCrop) {
        applyReferenceCrop();
      }
    };
    img.onerror = () => {
      console.error('Не удалось прочитать изображение:', file.name);
    };
    img.src = reader.result;
  };
  reader.onerror = () => {
    console.error('Ошибка чтения файла', reader.error);
  };
  reader.readAsDataURL(file);
}

function detectAutoOffsets(image, thresholdOverride = state.whiteThreshold) {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);

  const thresholdBase = Number(thresholdOverride);
  const whiteThreshold = clamp(
    Number.isFinite(thresholdBase) ? Math.round(thresholdBase) : state.whiteThreshold,
    WHITE_THRESHOLD_MIN,
    WHITE_THRESHOLD_MAX,
  );
  const tolerance = WHITE_ROW_TOLERANCE;
  const sampleX = Math.max(1, Math.floor(width / 600));
  const sampleY = Math.max(1, Math.floor(height / 600));

  const pixelIsWhite = (x, y) => {
    const index = (y * width + x) * 4;
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    if (luminance < whiteThreshold) {
      return false;
    }

    const minChannel = Math.min(r, g, b);
    if (minChannel >= whiteThreshold - 12) {
      return true;
    }

    const maxChannel = Math.max(r, g, b);
    return maxChannel >= whiteThreshold + 4 && minChannel >= whiteThreshold - 20;
  };

  const rowIsWhite = (y) => {
    let total = 0;
    let white = 0;
    for (let x = 0; x < width; x += sampleX) {
      total += 1;
      if (pixelIsWhite(x, y)) {
        white += 1;
      }
    }
    if ((width - 1) % sampleX !== 0) {
      total += 1;
      if (pixelIsWhite(width - 1, y)) {
        white += 1;
      }
    }
    return white / total >= tolerance;
  };

  const columnIsWhite = (x) => {
    let total = 0;
    let white = 0;
    for (let y = 0; y < height; y += sampleY) {
      total += 1;
      if (pixelIsWhite(x, y)) {
        white += 1;
      }
    }
    if ((height - 1) % sampleY !== 0) {
      total += 1;
      if (pixelIsWhite(x, height - 1)) {
        white += 1;
      }
    }
    return white / total >= tolerance;
  };

  let top = 0;
  while (top < height && rowIsWhite(top)) top += 1;

  let bottom = height - 1;
  while (bottom >= top && rowIsWhite(bottom)) bottom -= 1;

  let left = 0;
  while (left < width && columnIsWhite(left)) left += 1;

  let right = width - 1;
  while (right >= left && columnIsWhite(right)) right -= 1;

  if (left >= right) {
    left = 0;
    right = width - 1;
  }

  if (top >= bottom) {
    top = 0;
    bottom = height - 1;
  }

  const margin = Math.round(Math.min(width, height) * 0.005);

  const topOffset = clamp(top - margin, 0, height - 1);
  const bottomOffset = clamp(height - 1 - bottom - margin, 0, height - 1);
  const leftOffset = clamp(left - margin, 0, width - 1);
  const rightOffset = clamp(width - 1 - right - margin, 0, width - 1);

  return {
    top: topOffset,
    bottom: bottomOffset,
    left: leftOffset,
    right: rightOffset,
  };
}

function createImageCard(item) {
  const fragment = imageTemplate.content.cloneNode(true);
  const card = fragment.querySelector('.image-card');
  const title = fragment.querySelector('.image-card__title');
  const subtitle = fragment.querySelector('.image-card__subtitle');
  const previewCanvas = fragment.querySelector('.preview');
  const previewSize = fragment.querySelector('.preview-size');
  const manualToggle = fragment.querySelector('.manual-toggle');
  const slidersBlock = fragment.querySelector('.sliders');
  const sliderTop = fragment.querySelector('.slider-top');
  const sliderBottom = fragment.querySelector('.slider-bottom');
  const sliderLeft = fragment.querySelector('.slider-left');
  const sliderRight = fragment.querySelector('.slider-right');
  const valueTop = fragment.querySelector('.value-top');
  const valueBottom = fragment.querySelector('.value-bottom');
  const valueLeft = fragment.querySelector('.value-left');
  const valueRight = fragment.querySelector('.value-right');
  const resetButton = fragment.querySelector('.reset-auto');
  const removeButton = fragment.querySelector('.remove-btn');

  title.textContent = item.file.name;
  subtitle.textContent = `Исходный размер: ${item.width} × ${item.height} px`;
  previewSize.textContent = '';

  const sliderElements = [sliderTop, sliderBottom, sliderLeft, sliderRight];
  sliderElements.forEach((slider) => {
    slider.min = '0';
    slider.max = String(slider === sliderTop || slider === sliderBottom ? item.height - 1 : item.width - 1);
    slider.disabled = true;
  });

  manualToggle.addEventListener('change', () => {
    setManualMode(item, manualToggle.checked);
  });

  const sliderHandler = (side, slider) => {
    slider.addEventListener('input', () => {
      if (!item.isManual) {
        return;
      }
      applyOffsetChange(item, side, Number(slider.value));
    });
  };

  sliderHandler('top', sliderTop);
  sliderHandler('bottom', sliderBottom);
  sliderHandler('left', sliderLeft);
  sliderHandler('right', sliderRight);

  resetButton.addEventListener('click', () => {
    const autoOffsets = detectAutoOffsets(item.image);
    item.autoOffsets = { ...autoOffsets };
    item.offsets = { ...autoOffsets };
    manualToggle.checked = false;
    setManualMode(item, false);
    updatePreview(item);
  });

  removeButton.addEventListener('click', () => {
    removeImageItem(item.id);
  });

  card.dataset.id = item.id;

  item.elements = {
    card,
    subtitle,
    previewCanvas,
    previewSize,
    manualToggle,
    slidersBlock,
    sliders: {
      top: sliderTop,
      bottom: sliderBottom,
      left: sliderLeft,
      right: sliderRight,
    },
    values: {
      top: valueTop,
      bottom: valueBottom,
      left: valueLeft,
      right: valueRight,
    },
  };

  imagesContainer.appendChild(fragment);
  updateSliderUI(item);
}

function setManualMode(item, manual) {
  item.isManual = manual;
  const { slidersBlock, sliders, manualToggle } = item.elements;
  slidersBlock.hidden = !manual;
  Object.values(sliders).forEach((slider) => {
    slider.disabled = !manual;
  });

  manualToggle.checked = manual;
  if (!manual) {
    if (state.applyFirstCrop) {
      applyReferenceCrop();
    } else {
      item.offsets = { ...item.autoOffsets };
      updateSliderUI(item);
      updatePreview(item);
    }
    return;
  }

  updateSliderUI(item);
  updatePreview(item);

  if (state.applyFirstCrop && item.isManual && isReferenceItem(item)) {
    applyReferenceCrop();
  }
}

function applyOffsetChange(item, side, value) {
  const { offsets } = item;
  const maxValue = side === 'top' || side === 'bottom' ? item.height - 1 : item.width - 1;
  offsets[side] = clamp(Math.round(value), 0, maxValue);

  const cropWidth = item.width - offsets.left - offsets.right;
  if (cropWidth < MIN_CROP_PIXELS) {
    if (side === 'left') {
      offsets.right = clamp(item.width - MIN_CROP_PIXELS - offsets.left, 0, item.width - 1);
    } else if (side === 'right') {
      offsets.left = clamp(item.width - MIN_CROP_PIXELS - offsets.right, 0, item.width - 1);
    }
  }

  const cropHeight = item.height - offsets.top - offsets.bottom;
  if (cropHeight < MIN_CROP_PIXELS) {
    if (side === 'top') {
      offsets.bottom = clamp(item.height - MIN_CROP_PIXELS - offsets.top, 0, item.height - 1);
    } else if (side === 'bottom') {
      offsets.top = clamp(item.height - MIN_CROP_PIXELS - offsets.bottom, 0, item.height - 1);
    }
  }

  updateSliderUI(item);
  updatePreview(item);
}

function updateSliderUI(item) {
  const { offsets } = item;
  const { sliders, values } = item.elements;

  sliders.top.value = String(offsets.top);
  sliders.bottom.value = String(offsets.bottom);
  sliders.left.value = String(offsets.left);
  sliders.right.value = String(offsets.right);

  values.top.textContent = offsets.top;
  values.bottom.textContent = offsets.bottom;
  values.left.textContent = offsets.left;
  values.right.textContent = offsets.right;
}

function updatePreview(item) {
  const { previewCanvas, previewSize } = item.elements;
  const { offsets } = item;

  const cropWidth = Math.max(1, item.width - offsets.left - offsets.right);
  const cropHeight = Math.max(1, item.height - offsets.top - offsets.bottom);

  const maxPreviewSide = 320;
  const scale = Math.min(1, maxPreviewSide / Math.max(cropWidth, cropHeight));
  const canvasWidth = Math.max(1, Math.round(cropWidth * scale));
  const canvasHeight = Math.max(1, Math.round(cropHeight * scale));

  previewCanvas.width = canvasWidth;
  previewCanvas.height = canvasHeight;
  previewCanvas.style.width = '100%';
  previewCanvas.style.height = 'auto';
  previewCanvas.style.aspectRatio = `${cropWidth} / ${cropHeight}`;

  const ctx = previewCanvas.getContext('2d');
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    item.image,
    offsets.left,
    offsets.top,
    cropWidth,
    cropHeight,
    0,
    0,
    canvasWidth,
    canvasHeight,
  );

  previewSize.textContent = `Обрезанный размер: ${cropWidth} × ${cropHeight} px`;
}

function removeImageItem(id) {
  const index = state.items.findIndex((image) => image.id === id);
  if (index === -1) return;

  const [item] = state.items.splice(index, 1);
  item.elements.card.remove();
  updateDownloadButtonState();

  if (state.applyFirstCrop) {
    applyReferenceCrop();
  }
}

function updateDownloadButtonState() {
  downloadButton.disabled = state.items.length === 0;
}

async function handleDownloadAll() {
  if (!state.items.length) {
    return;
  }

  const rawMaxDimension = Number(maxDimensionInput.value);
  const maxDimension = Number.isFinite(rawMaxDimension) && rawMaxDimension > 0 ? Math.round(rawMaxDimension) : 500;

  const baseNameRaw = baseNameInput.value.trim();
  const baseName = baseNameRaw ? baseNameRaw.replace(/\s+/g, '_') : 'card';

  let index = Number.parseInt(startIndexInput.value, 10);
  if (Number.isNaN(index)) {
    index = 1;
  }

  downloadButton.disabled = true;
  const originalText = downloadButton.textContent;
  downloadButton.textContent = 'Сохранение…';

  const itemsForDownload = [...state.items].sort((a, b) => {
    const timeDiff = (a.file.lastModified || 0) - (b.file.lastModified || 0);
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return a.file.name.localeCompare(b.file.name);
  });

  try {
    for (const item of itemsForDownload) {
      const blob = await exportImage(item, maxDimension);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${baseName}${index}.jpg`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      const href = link.href;
      setTimeout(() => URL.revokeObjectURL(href), 2000);
      if (DOWNLOAD_DELAY_MS > 0) {
        // Небольшая пауза помогает браузеру обработать последовательные загрузки
        // и избежать пропуска части файлов в больших партиях.
        // eslint-disable-next-line no-await-in-loop
        await delay(DOWNLOAD_DELAY_MS);
      }
      index += 1;
    }
  } catch (error) {
    console.error('Не удалось сохранить изображения', error);
  } finally {
    downloadButton.disabled = state.items.length === 0;
    downloadButton.textContent = originalText;
    startIndexInput.value = String(index);
  }
}

function exportImage(item, maxDimension) {
  return new Promise((resolve, reject) => {
    const { offsets } = item;
    const cropWidth = Math.max(1, item.width - offsets.left - offsets.right);
    const cropHeight = Math.max(1, item.height - offsets.top - offsets.bottom);

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropWidth;
    cropCanvas.height = cropHeight;
    const cropCtx = cropCanvas.getContext('2d');
    cropCtx.imageSmoothingEnabled = true;
    cropCtx.drawImage(
      item.image,
      offsets.left,
      offsets.top,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight,
    );

    let targetCanvas = cropCanvas;

    const longestSide = Math.max(cropWidth, cropHeight);
    if (longestSide > maxDimension) {
      const scale = maxDimension / longestSide;
      const scaledWidth = Math.max(1, Math.round(cropWidth * scale));
      const scaledHeight = Math.max(1, Math.round(cropHeight * scale));
      targetCanvas = document.createElement('canvas');
      targetCanvas.width = scaledWidth;
      targetCanvas.height = scaledHeight;
      const targetCtx = targetCanvas.getContext('2d');
      targetCtx.imageSmoothingEnabled = true;
      targetCtx.drawImage(cropCanvas, 0, 0, scaledWidth, scaledHeight);
    }

    targetCanvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Не удалось создать JPG'));
        }
      },
      'image/jpeg',
      0.92,
    );
  });
}

function sanitizeWhiteThreshold(rawValue) {
  const numeric = typeof rawValue === 'number' ? rawValue : Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_WHITE_THRESHOLD;
  }
  const rounded = Math.round(numeric);
  return clamp(rounded, WHITE_THRESHOLD_MIN, WHITE_THRESHOLD_MAX);
}

function recomputeAutoOffsets() {
  if (!state.items.length) {
    return;
  }

  state.items.forEach((item) => {
    const autoOffsets = detectAutoOffsets(item.image, state.whiteThreshold);
    item.autoOffsets = { ...autoOffsets };
  });

  if (state.applyFirstCrop) {
    applyReferenceCrop();
    return;
  }

  state.items.forEach((item) => {
    if (!item.isManual) {
      item.offsets = { ...item.autoOffsets };
    }
    updateSliderUI(item);
    updatePreview(item);
  });
}

function applyReferenceCrop() {
  const reference = getReferenceItem();
  if (!reference) {
    return;
  }

  if (!reference.isManual) {
    reference.offsets = { ...reference.autoOffsets };
  }
  const template = { ...reference.offsets };

  state.items.forEach((item, index) => {
    if (index === 0) {
      updateSliderUI(reference);
      updatePreview(reference);
      return;
    }

    if (item.isManual) {
      updateSliderUI(item);
      updatePreview(item);
      return;
    }

    const adaptedOffsets = adaptOffsetsToItem(template, item);
    item.offsets = adaptedOffsets;
    updateSliderUI(item);
    updatePreview(item);
  });
}

function adaptOffsetsToItem(templateOffsets, item) {
  const { width, height } = item;
  const safeTemplate = {
    top: templateOffsets.top ?? 0,
    bottom: templateOffsets.bottom ?? 0,
    left: templateOffsets.left ?? 0,
    right: templateOffsets.right ?? 0,
  };

  let top = clamp(Math.round(safeTemplate.top), 0, Math.max(0, height - MIN_CROP_PIXELS));
  let bottom = clamp(Math.round(safeTemplate.bottom), 0, Math.max(0, height - MIN_CROP_PIXELS));
  let left = clamp(Math.round(safeTemplate.left), 0, Math.max(0, width - MIN_CROP_PIXELS));
  let right = clamp(Math.round(safeTemplate.right), 0, Math.max(0, width - MIN_CROP_PIXELS));

  [top, bottom] = fitPairToLimit(top, bottom, Math.max(0, height - MIN_CROP_PIXELS));
  [left, right] = fitPairToLimit(left, right, Math.max(0, width - MIN_CROP_PIXELS));

  return { top, bottom, left, right };
}

function fitPairToLimit(first, second, limit) {
  if (limit <= 0) {
    return [0, 0];
  }

  let a = clamp(first, 0, limit);
  let b = clamp(second, 0, limit);
  let total = a + b;

  if (total <= limit) {
    return [a, b];
  }

  const overflow = total - limit;
  if (overflow > 0) {
    const reduceA = Math.round((overflow * (a || 0)) / (total || 1));
    const reduceB = overflow - reduceA;
    a = clamp(a - reduceA, 0, limit);
    b = clamp(b - reduceB, 0, limit);
    total = a + b;
    if (total > limit) {
      const extra = total - limit;
      if (b >= extra) {
        b = clamp(b - extra, 0, limit);
      } else {
        a = clamp(a - (extra - b), 0, limit);
        b = 0;
      }
    }
  }

  return [a, b];
}

function getReferenceItem() {
  return state.items[0] || null;
}

function isReferenceItem(item) {
  const reference = getReferenceItem();
  return Boolean(reference && reference.id === item.id);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
