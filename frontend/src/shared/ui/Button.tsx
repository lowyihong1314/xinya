/**
 * 按钮。所有可点击的东西都用它，不要自己写 <button className="...">。
 *
 * 变体是**语义**的（primary / secondary / ghost / destructive），不是外观的
 * （不要出现 "green" "big" 这种名字）—— 换主题时语义名不用改，外观名要全仓搜。
 */
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "../lib/cn";

const buttonVariants = cva(
  // 公共：布局、交互、禁用态、焦点环。变体只管颜色和尺寸。
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] " +
    "font-medium transition-colors select-none " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] " +
    "disabled:pointer-events-none disabled:opacity-50 " +
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-strong",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        outline: "border border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // 默认 h-10 而不是更小：主要用户在手机上操作，触控目标不能小于 40px。
        sm: "h-9 px-3 text-sm",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** 渲染成子元素（比如把样式套给 <Link>），而不是 <button>。 */
  asChild?: boolean;
  /** 提交中。会显示转圈**并自动禁用**——不禁用的话用户能连点，重复提交。 */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";

  // ★ asChild 时**只能传单一子节点**。
  //   Radix 的 Slot 判定是 `Children.count(children) === 1 && isValidElement(children)`，
  //   而 `{loading ? <Loader2/> : null}{children}` 即使 loading 为假也是**两个**子节点
  //   （null 也算一个，实测 Children.count([null, <a/>]) === 2）。
  //   于是 Slot 抛 "Slot failed to slot onto its children"，
  //   每一处 <Button asChild><Link>…</Link></Button> 直接把整个页面炸掉。
  //   所以 asChild 分支原样透传 children，转圈图标只在普通 button 分支渲染
  //   —— asChild 的场景（把样式套给 <Link>）本来也不该有 loading 态。
  const content = asChild ? (
    children
  ) : (
    <>
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </>
  );

  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      // Slot 会把属性合并到子元素上；<Link> 没有 disabled 属性，传了会变成
      // 一个无效的 DOM 属性并在控制台报警告，所以 asChild 时不传。
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {content}
    </Comp>
  );
});

export { buttonVariants };
