import test from 'node:test';
import assert from 'node:assert/strict';
import { createFocus } from '../src/ui/focus.js';

test('焦点：交互窗抢占焦点，检视窗让位回到空闲', () => {
  const focus = createFocus();
  assert.equal(focus.current().view, null);
  assert.equal(focus.hasPending(), false);

  // 检视窗开着时来交互请求 → 检视被让位
  assert.equal(focus.openInspect(2).ok, true);
  assert.equal(focus.current().view, 'inspect');
  focus.openInteraction({ type: 'select', prompt: '响应' });
  assert.equal(focus.current().view, 'interaction');
  assert.equal(focus.current().inspect, null);
});

test('焦点：交互展开期间拒绝检视', () => {
  const focus = createFocus();
  focus.openInteraction({ type: 'select', prompt: '判定' });
  const res = focus.openInspect(1);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'interaction');
  assert.equal(focus.current().view, 'interaction');
});

test('焦点：收起后可检视，恢复时检视让位且徽标正确', () => {
  const focus = createFocus();
  focus.openInteraction({ type: 'select', prompt: '弃牌' });
  focus.minimizeInteraction();
  let cur = focus.current();
  assert.equal(cur.view, null);
  assert.equal(cur.pending, true); // 待处理徽标出现
  assert.equal(focus.hasPending(), true);
  assert.equal(focus.interactionOpen(), false);

  // 收起期间检视可占用弹窗，徽标保持
  assert.equal(focus.openInspect(3).ok, true);
  cur = focus.current();
  assert.equal(cur.view, 'inspect');
  assert.equal(cur.pending, true);

  // 恢复交互 → 检视让位，弹窗交还交互
  focus.restoreInteraction();
  cur = focus.current();
  assert.equal(cur.view, 'interaction');
  assert.equal(cur.minimized, false);
  assert.equal(focus.interactionOpen(), true);
});

test('焦点：决策完成后交互关闭，不残留徽标', () => {
  const focus = createFocus();
  focus.openInteraction({ type: 'select', prompt: '救援' });
  focus.minimizeInteraction();
  assert.equal(focus.hasPending(), true);
  focus.dismissInteraction();
  const cur = focus.current();
  assert.equal(cur.view, null);
  assert.equal(cur.pending, false);
  assert.equal(focus.hasPending(), false);
});

test('焦点：没有交互时收起是无副作用空操作', () => {
  const focus = createFocus();
  focus.minimizeInteraction();
  focus.restoreInteraction();
  assert.equal(focus.current().view, null);
  assert.equal(focus.current().pending, false);
});

test('焦点：检视可正常开关', () => {
  const focus = createFocus();
  focus.openInspect(0);
  assert.equal(focus.current().view, 'inspect');
  assert.equal(focus.current().seat, 0);
  focus.closeInspect();
  assert.equal(focus.current().view, null);
});
