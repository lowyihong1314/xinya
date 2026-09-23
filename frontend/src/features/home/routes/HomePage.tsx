import { useAuth } from "@/shared/auth/AuthProvider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui";

export function HomePage() {
  const { user, permissions } = useAuth();

  return (
    <div className="space-y-6">
      <section>
        <h1 className="font-serif text-2xl">
          {user ? `你好，${user.display_name || user.username}` : "你好"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {user?.department_name ? `${user.department_name}` : "心芽 · UTBA"}
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>重写进行中</CardTitle>
          <CardDescription>
            地基已就位：设计令牌、公共 UI、HTTP 客户端、会话与权限守卫。
            业务模块按顺序搬过来，搬一个删一个旧的。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            当前账号拥有 {permissions.size} 项权限。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
