// 「别人眼中的我」 shares the same Socket.IO server as the buzzer / quiz game.
import { publicUrl } from "../../../js/basePath";

export { connectQuizSocket as connectMirrorSocket } from "../quiz/quizSocket";

export function buildMirrorPlayerUrl(token: string): string {
  if (typeof window === "undefined") return "";
  // 5173 判断跟部署前缀无关，别顺手删：Vite dev server 上没有后端的 /mirror 短链路由，
  // 只能退回 hash 路由；生产才有短链。
  if (window.location.port === "5173") {
    // 预期产物：http://localhost:5173/#/music/turntable/mirror?token=xxx
    return publicUrl(`/#/music/turntable/mirror?token=${token}`);
  }
  // 这串直接喂给 QRCode.toDataURL 给人扫，丢了前缀就是扫出死链。
  // 预期产物：https://utbabuddha.com/UTBA_DEMO/mirror?token=xxx（BASE_PATH 为空时与改前逐字节一致）
  return publicUrl(`/mirror?token=${token}`);
}
