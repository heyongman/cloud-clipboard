import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPreviewWidth,
  getPreviewFrameLayout,
  getExportPixelRatio,
  getExportMountStyle,
  getExportNodeStyle,
  createExportFileName,
} from '../src/utils/markdown-export.mjs';

test('当前设备模式会基于容器宽度并限制最小值', () => {
  assert.equal(getPreviewWidth('current', 1200), 1200);
  assert.equal(getPreviewWidth('current', 280), 320);
});

test('移动端和桌面端模式使用固定内容宽度', () => {
  assert.equal(getPreviewWidth('mobile', 1200), 390);
  assert.equal(getPreviewWidth('desktop', 1200), 960);
});

test('预览框在内容超出容器时使用内容宽度并左对齐', () => {
  assert.deepEqual(getPreviewFrameLayout(390, 320), {
    frameWidth: 390,
    justifyContent: 'flex-start',
  });
});

test('预览框在内容未超出容器时保持居中', () => {
  assert.deepEqual(getPreviewFrameLayout(390, 640), {
    frameWidth: 640,
    justifyContent: 'center',
  });
});

test('导出像素比会限制在安全上限内', () => {
  assert.equal(getExportPixelRatio(1), 1);
  assert.equal(getExportPixelRatio(2), 2);
  assert.equal(getExportPixelRatio(4), 3);
  assert.equal(getExportPixelRatio(undefined), 1);
});

test('导出节点样式会移除页面预览造成的偏移因素', () => {
  assert.deepEqual(getExportNodeStyle(390), {
    width: '390px',
    maxWidth: 'none',
    margin: '0',
    transform: 'none',
  });
});

test('离屏挂载层负责隐藏导出节点，而不是修改导出根节点定位', () => {
  assert.deepEqual(getExportMountStyle(), {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    zIndex: '-1',
    pointerEvents: 'none',
  });
});

test('导出文件名包含日期时间和模式标识', () => {
  const now = new Date('2026-03-30T08:09:10Z');
  assert.equal(
    createExportFileName('desktop', now),
    'markdown-desktop-20260330-080910.png',
  );
});
