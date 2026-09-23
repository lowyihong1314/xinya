/**
 * 公共 UI 的统一出口。页面一律 `import { Button, Card } from "@/shared/ui"`，
 * 不要深链到具体文件 —— 那样以后拆分/重命名组件会牵动几十个调用点。
 */
export { Button, buttonVariants, type ButtonProps } from "./Button";
export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./Card";
export { Input } from "./Input";
export { EmptyState, ErrorState, LoadingState } from "./states";
