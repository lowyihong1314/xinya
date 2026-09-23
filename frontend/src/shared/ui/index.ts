/**
 * 公共 UI 的统一出口。页面一律 `import { Button, Card } from "@/shared/ui"`，
 * 不要深链到具体文件 —— 那样以后拆分/重命名组件会牵动几十个调用点。
 */
export { Badge } from "./Badge";
export { Button, buttonVariants, type ButtonProps } from "./Button";
export { Checkbox } from "./Checkbox";
export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./Card";
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./Dialog";
export { ConfirmProvider, useConfirm, type ConfirmOptions } from "./confirm";
export { Input } from "./Input";
export { Label } from "./Label";
export { PageHeader } from "./PageHeader";
export { Select } from "./Select";
export { Skeleton } from "./Skeleton";
export { EmptyState, ErrorState, LoadingState } from "./states";
export { Textarea } from "./Textarea";
export { ToastProvider, useToast } from "./toast";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";
export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./Table";
