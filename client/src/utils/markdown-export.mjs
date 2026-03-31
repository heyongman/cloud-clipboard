const MODE_WIDTHS = {
  mobile: 390,
  desktop: 960,
};

const MIN_CURRENT_WIDTH = 320;
const MAX_PIXEL_RATIO = 3;

function pad(number) {
  return String(number).padStart(2, '0');
}

function normalizeWidth(width, fallback = MIN_CURRENT_WIDTH) {
  return Number.isFinite(width) ? Math.max(MIN_CURRENT_WIDTH, Math.round(width)) : fallback;
}

export function getPreviewWidth(mode, containerWidth) {
  if (mode === 'mobile' || mode === 'desktop') {
    return MODE_WIDTHS[mode];
  }

  return normalizeWidth(containerWidth);
}

export function getPreviewFrameLayout(previewWidth, hostWidth) {
  const contentWidth = normalizeWidth(previewWidth);
  const containerWidth = normalizeWidth(hostWidth, contentWidth);
  const shouldScroll = contentWidth > containerWidth;

  return {
    frameWidth: shouldScroll ? contentWidth : containerWidth,
    justifyContent: shouldScroll ? 'flex-start' : 'center',
  };
}

export function getExportNodeStyle(width) {
  const contentWidth = normalizeWidth(width);

  return {
    width: `${contentWidth}px`,
    maxWidth: 'none',
    margin: '0',
    transform: 'none',
  };
}

export function getExportMountStyle() {
  return {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    zIndex: '-1',
    pointerEvents: 'none',
  };
}

export function getExportPixelRatio(devicePixelRatio) {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;

  return Math.min(MAX_PIXEL_RATIO, ratio);
}

export function createExportFileName(mode, now = new Date()) {
  const year = now.getUTCFullYear();
  const month = pad(now.getUTCMonth() + 1);
  const day = pad(now.getUTCDate());
  const hour = pad(now.getUTCHours());
  const minute = pad(now.getUTCMinutes());
  const second = pad(now.getUTCSeconds());

  return `markdown-${mode}-${year}${month}${day}-${hour}${minute}${second}.png`;
}
