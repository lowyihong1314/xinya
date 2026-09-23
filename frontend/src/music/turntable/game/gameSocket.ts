// The 问答游戏 shares the same Socket.IO server as the buzzer.
import { publicUrl } from "../../../js/basePath";

export { connectQuizSocket as connectGameSocket } from "../quiz/quizSocket";

export function buildGamePlayerUrl(token: string): string {
  if (typeof window === "undefined") return "";
  // 5173 判断跟部署前缀无关，别顺手删：Vite dev server 上没有后端的 /game 短链路由。
  if (window.location.port === "5173") {
    // 预期产物：http://localhost:5173/#/music/turntable/game?token=xxx
    return publicUrl(`/#/music/turntable/game?token=${token}`);
  }
  // 这串直接喂给 QRCode.toDataURL 给人扫。
  // 预期产物：https://utbabuddha.com/UTBA_DEMO/game?token=xxx（BASE_PATH 为空时与改前逐字节一致）
  return publicUrl(`/game?token=${token}`);
}
