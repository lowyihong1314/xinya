import { Input, Label } from "@/shared/ui";

/**
 * 「起始日期 / 截止日期」两个字段。凭证列表、试算平衡表、科目明细账三处都要，
 * 而且传给后端的都是同一对 start / end 查询参数。
 *
 * 返回的是**片段**（两个并列的字段块），不是带布局的容器 ——
 * 调用方各有各的栅格（有的还要在中间塞状态下拉），由它们决定怎么排。
 */
export function DateRangeFields({
  idPrefix,
  start,
  end,
  onStartChange,
  onEndChange,
}: {
  /** 同一个页面上可能有两组日期，id 必须唯一，否则 <label for> 会指错。 */
  idPrefix: string;
  start: string;
  end: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-start`}>起始日期</Label>
        <Input
          id={`${idPrefix}-start`}
          type="date"
          value={start}
          onChange={(e) => onStartChange(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-end`}>截止日期</Label>
        <Input
          id={`${idPrefix}-end`}
          type="date"
          value={end}
          onChange={(e) => onEndChange(e.target.value)}
        />
      </div>
    </>
  );
}
