import { describe, it, expect, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { useArrangeProgress } from '@/views/teaching/composables/useArrangeProgress';

/** 构造 useAutoArrange 形状的进度 refs（无 processed/total 等批量字段） */
function makeAuto() {
  return {
    progressVisible: ref(false),
    progressType: ref('single'),
    progressModeLabel: ref('标准模式'),
    progressFinished: ref(false),
    progressCurrentPhase: ref(0),
    progressMessage: ref(''),
  };
}

/** 构造 useBatchArrange 形状的进度 refs（无 currentPhase） */
function makeBatch() {
  return {
    progressVisible: ref(false),
    progressType: ref('batch'),
    progressModeLabel: ref('全量模式'),
    progressFinished: ref(false),
    progressProcessed: ref(0),
    progressTotal: ref(0),
    progressCurrentCourseName: ref(''),
    progressCumulativeAssigned: ref(0),
    progressCumulativeUnassigned: ref(0),
    progressMessage: ref(''),
  };
}

describe('useArrangeProgress', () => {
  let auto;
  let batch;
  let arrangeResultVisible;
  let batchResultVisible;
  let progress;

  beforeEach(() => {
    auto = makeAuto();
    batch = makeBatch();
    arrangeResultVisible = ref(false);
    batchResultVisible = ref(false);
    progress = useArrangeProgress({ auto, batch, arrangeResultVisible, batchResultVisible });
  });

  describe('活动来源机制', () => {
    it('默认以 auto 为活动来源', () => {
      expect(progress.progressType.value).toBe('single');
      expect(progress.progressModeLabel.value).toBe('标准模式');
    });

    it('batch 弹窗打开后切换为 batch 来源', async () => {
      batch.progressVisible.value = true;
      await nextTick();

      expect(progress.progressType.value).toBe('batch');
      expect(progress.progressModeLabel.value).toBe('全量模式');
    });

    it('auto 弹窗再次打开后切回 auto，不被 batch 残值遮蔽', async () => {
      batch.progressVisible.value = true;
      await nextTick();
      batch.progressVisible.value = false;
      auto.progressVisible.value = true;
      await nextTick();

      expect(progress.progressType.value).toBe('single');
    });

    it('弹窗关闭后 active 保持不变（关闭动画期间内容不闪变）', async () => {
      batch.progressVisible.value = true;
      await nextTick();
      batch.progressVisible.value = false;
      await nextTick();

      expect(progress.progressType.value).toBe('batch');
    });
  });

  describe('字段代理', () => {
    it('缺失字段回退默认值（auto 无批量进度字段）', () => {
      expect(progress.progressProcessed.value).toBe(0);
      expect(progress.progressTotal.value).toBe(0);
      expect(progress.progressCurrentCourseName.value).toBe('');
      expect(progress.progressCumulativeAssigned.value).toBe(0);
      expect(progress.progressCumulativeUnassigned.value).toBe(0);
    });

    it('batch 来源时代理批量进度字段，currentPhase 回退 0', async () => {
      batch.progressVisible.value = true;
      batch.progressProcessed.value = 3;
      batch.progressTotal.value = 10;
      batch.progressCurrentCourseName.value = '高等数学';
      await nextTick();

      expect(progress.progressProcessed.value).toBe(3);
      expect(progress.progressTotal.value).toBe(10);
      expect(progress.progressCurrentCourseName.value).toBe('高等数学');
      expect(progress.progressCurrentPhase.value).toBe(0);
    });
  });

  describe('progressVisible 双向代理', () => {
    it('任一来源打开即为可见', async () => {
      expect(progress.progressVisible.value).toBe(false);
      auto.progressVisible.value = true;
      await nextTick();
      expect(progress.progressVisible.value).toBe(true);
    });

    it('set false 时关闭当前打开的来源弹窗', async () => {
      auto.progressVisible.value = true;
      await nextTick();

      progress.progressVisible.value = false;

      expect(auto.progressVisible.value).toBe(false);
      expect(batch.progressVisible.value).toBe(false);
    });
  });

  describe('handleProgressClose', () => {
    it('auto 完成后关闭进度弹窗并弹出单课程结果，复位 finished', async () => {
      auto.progressVisible.value = true;
      auto.progressFinished.value = true;
      await nextTick();

      progress.handleProgressClose();

      expect(auto.progressVisible.value).toBe(false);
      expect(arrangeResultVisible.value).toBe(true);
      expect(batchResultVisible.value).toBe(false);
      // 关键回归：finished 标志必须复位，避免残留干扰下一次分支判断
      expect(auto.progressFinished.value).toBe(false);
    });

    it('batch 完成后弹出批量结果弹窗', async () => {
      batch.progressVisible.value = true;
      batch.progressFinished.value = true;
      await nextTick();

      progress.handleProgressClose();

      expect(batchResultVisible.value).toBe(true);
      expect(arrangeResultVisible.value).toBe(false);
      expect(batch.progressFinished.value).toBe(false);
    });

    it('未完成时关闭进度弹窗不弹出结果', async () => {
      auto.progressVisible.value = true;
      await nextTick();

      progress.handleProgressClose();

      expect(arrangeResultVisible.value).toBe(false);
      expect(batchResultVisible.value).toBe(false);
    });
  });
});
