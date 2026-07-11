import { useLayoutEffect, useRef, useState } from "react";

type Options = {
  // 单张卡片的最小宽度（与 grid 的 minmax 一致）。
  minCardWidth: number;
  // grid 的间距。
  gap: number;
  // 卡片宽高比（width / height），如 4:2 => 2。
  ratio: number;
  // 网格底部到视口底部预留的空白。
  bottomGap?: number;
};

// 根据容器实际宽高自适应计算「一页显示多少张卡片」：
// 列数由宽度决定，行数由从网格顶部到视口底部的可用高度决定。
export function useAdaptivePageSize<T extends HTMLElement>(options: Options) {
  const { minCardWidth, gap, ratio, bottomGap = 16 } = options;
  const ref = useRef<T | null>(null);
  const [pageSize, setPageSize] = useState(12);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }

    let frame = 0;
    const compute = () => {
      const width = el.clientWidth;
      if (!width) {
        return;
      }
      const cols = Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)));
      const cardWidth = (width - (cols - 1) * gap) / cols;
      const cardHeight = cardWidth / ratio;
      const top = el.getBoundingClientRect().top;
      const availableHeight = Math.max(0, window.innerHeight - top - bottomGap);
      const rows = Math.max(1, Math.floor((availableHeight + gap) / (cardHeight + gap)));
      setPageSize(Math.max(1, cols * rows));
    };
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(compute);
    };

    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    window.addEventListener("resize", schedule);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [minCardWidth, gap, ratio, bottomGap]);

  return { ref, pageSize };
}
