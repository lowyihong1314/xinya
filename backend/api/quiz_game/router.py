"""问答游戏（Kahoot 式）的 HTTP 路由。原 backend/app/quiz_game/routes.py
（Flask Blueprint，挂在 /api/quiz_game）+ backend/app/quiz_game/socket_events.py（10 个入向事件）。

题库 CRUD 和 AI 出题只做框架适配：装饰器、参数提取、响应构造。
校验顺序、状态码、错误文案、响应体的键名与嵌套形状**逐字照搬** ——
前端 frontend/src/music/turntable/game/ 的 api.ts 按 ``status`` / ``message`` 分支，
主持台与玩家页按 ``set`` / ``sets`` / ``session`` / ``questions`` 四个键取值，改一个就是线上故障。

对局状态层（Redis 读写、计分、快照拼装）在同目录 service.py；AI 出题在 ai.py。

── URL 变化（/api 这一段没了；BASE_PATH 由 nginx 剥掉，应用内一律写裸路径）────

    GET       /api/quiz_game/sets                       → GET       /quiz_game/sets
    POST      /api/quiz_game/sets                       → POST      /quiz_game/sets
    GET       /api/quiz_game/sets/<int:set_id>          → GET       /quiz_game/sets/{set_id:int}
    PUT|PATCH /api/quiz_game/sets/<int:set_id>          → PUT|PATCH /quiz_game/sets/{set_id:int}
    DELETE    /api/quiz_game/sets/<int:set_id>          → DELETE    /quiz_game/sets/{set_id:int}
    PUT       /api/quiz_game/sets/<int:set_id>/questions → PUT      /quiz_game/sets/{set_id:int}/questions
    POST      /api/quiz_game/ai/generate                → POST      /quiz_game/ai/generate
    POST      /api/quiz_game/session                    → POST      /quiz_game/session
    GET       /api/quiz_game/session/<token>            → GET       /quiz_game/session/{token}

⚠️ 路径参数写 ``{set_id:int}``（Starlette 的转换器），**不是**只靠 ``set_id: int`` 注解：
   Flask 的 ``<int:set_id>`` 碰上非整数是 **404**，只靠注解会变成 FastAPI 的 **422**，
   前端那条「题库不存在 → 回列表」的 404 分支就静默失效了。

── ★ 三条硬性约束（违反会启动即失败或线上事故）──────────────────────────

  ① 本文件**不能**写 ``from __future__ import annotations``：core.auth.login_required
     用 functools.wraps 包了一层，FastAPI 求值注解时用的是 core/auth.py 的命名空间，
     开了这行会在那里找不到 Optional 而**启动即 NameError**。
  ② 路由一律 ``def``（同步）：底下全是同步 Redis + 同步 DB 查询，
     写成 async def 会把 worker 的事件循环焊死。
  ③ 装饰器顺序：``@router.xxx`` 在上、``@login_required`` 在下。


═══════════ 入向动作：10 个 Socket.IO 事件 → POST 接口 ═══════════

规则见 docs/flask_to_fastAPI/16-入向事件转POST.md，与已经搬完的 api/quiz 一致：

  · 原来 ``emit(..., to=request.sid)``（只回发送者）→ **就是 HTTP 响应体**
  · 原来 ``emit(..., to=room)``（广播房间）→ ``publish_sync("quiz_game", token, ...)``
  · 原来 ``join_room(room)`` → **不需要**，客户端订阅 SSE 时带 ``?room={token}``
  · 原来的 ``request.sid`` → SSE 的 connection_id（ready 事件里下发，请求体里带回来）

事件与路由的对应：

    game:time:ping      → POST /quiz_game/time/ping
    game:host:join      → POST /quiz_game/host/join
    game:host:start     → POST /quiz_game/host/start
    game:host:next      → POST /quiz_game/host/next
    game:host:reveal    → POST /quiz_game/host/reveal
    game:host:podium    → POST /quiz_game/host/podium
    game:host:reset     → POST /quiz_game/host/reset
    game:host:kick      → POST /quiz_game/host/kick
    game:guest:join     → POST /quiz_game/guest/join
    game:guest:answer   → POST /quiz_game/guest/answer

出向事件名**一个字都不能改**（前端 addEventListener 按名字挂监听，改名 = 静默失联）：

    还走推送（SSE）：game:question、game:reveal、game:podium、game:lobby、
                     game:players、game:progress
    改走 HTTP 响应：game:host（→ /host/join 的 session）、
                     game:joined + game:player（→ /guest/join 的 joined + session）、
                     game:answered（→ /guest/answer 的 choice）、
                     game:answer_rejected（→ /guest/answer 的错误体）、
                     game:time:pong（→ /time/ping 的响应）
    改走 HTTP 状态码：game:error

★ room_id 传的是**裸 room_token**，不是 ``service.socket_room()`` 拼出来的
  ``quizg:{token}`` —— core.realtime.channel_of 自己会拼成 ``rt:quiz_game:{token}``，
  传拼好的进去会变成 ``rt:quiz_game:quizg:{token}``，订阅端永远收不到。

★ ``sender`` 一律传请求体里的 ``connection_id``（没带就是 None）。带了它，发起者的
  前端会丢弃自己动作的推送回声（避免「本地乐观更新 → HTTP 响应 → 又被自己的广播覆盖」
  的状态回跳）。代价是：**发起者必须自己应用 HTTP 响应里的那份数据** ——
  本文件所有 publish_sync 推出去的载荷都同时出现在响应体里，就是为了让这件事做得到。
  广播和响应用的是**同一个对象**，不重算第二遍（``base_meta`` 里有 ``server_now_ms``，
  两次算会差几毫秒，主持台同时收到两份时倒计时会跳一下）。

★ 与 Socket.IO 的两处**有意的行为差异**：
  ① ``_emit_error`` 发的 ``game:error`` 载荷里有一个 ``status_code`` 键，HTTP 版没有 ——
     它现在就是 HTTP 响应的状态码本身。其余三个键（status / message / reason）不变。
  ② ``game:answer_rejected``（软拒绝：已答过 / 超时 / 未开放）和 ``game:error``
     在 HTTP 下形状一样，靠 ``reason`` 区分：
     ``reason in ("already_answered", "time_up", "not_open")`` 就是软拒绝，
     照原样只提示一句、不断线（前端原来的 onRejected 读的也正是 ``reason``）。
  ③ ``publish_sync`` 自己吞异常只返回 bool，而 Socket.IO 的 emit 走 Redis 消息队列、
     Redis 挂了会抛异常 → 原来接口回 500。现在广播丢了、接口仍回 200。
     这是 realtime 层的设计决定（广播失败不该让写操作看起来失败，重连会重拉 snapshot 自愈）。


═══════════ 「看着像 bug、但故意保留」 ═══════════

  ① ``game:host:join`` 原本**没有** ``_require_user()`` —— 谁知道 token 谁就能拿主持台
     快照（含正确答案！）。其余 6 个 host 事件都查登录。这个洞一直在，本次逐字保留，
     所以 ``POST /host/join`` 也**不能**挂 ``@login_required``。
     TODO(问答游戏): 要堵就连前端一起改，单独加会让现有主持台直接打不开。
  ② ``game:host:kick`` 在 ``guest_id`` 为空时**不踢人但照样广播一次 game:players**，
     而且 ``player_list`` 不校验房间存在 —— 房间过期时会广播一个空列表而不是报错。
     原样保留。
  ③ 更新题库的 ``update_set`` 用 ``if "title" in payload`` 判断「有没有传这个字段」，
     但 ``questions`` 用的是 ``isinstance(payload.get("questions"), list)``。
     于是传 ``{"questions": null}`` 是「不动题目」，传 ``{"questions": []}`` 是「清空题目」。
     两种写法并存是原样，别统一。
  ④ ``create_set`` / ``update_set`` 出错时先 ``db.session.rollback()`` 再翻译异常，
     而只读的 ``list_sets`` / ``get_set`` 不 rollback。保持。
  ⑤ ``replace_questions`` 路由传的是 ``payload.get("questions")``（可能是 None），
     由 ``_replace_questions`` 里的 ``raw_questions or []`` 兜底成「清空」；
     而 ``create_set`` / ``update_set`` 传进来的一定是 list。两条路的空值语义不同，别合并。
"""

from typing import Optional

from fastapi import APIRouter, Body

from backend.api.quiz_game import ai, service
from backend.core.auth import current_user, login_required
from backend.core.config import settings
from backend.core.db import db
from backend.core.realtime import RealtimeApp, publish_sync, register
from backend.core.responses import json_response
from backend.models.quiz_game import QuizGameQuestion, QuizGameSet

# prefix 用 settings.api_prefix 拼而不是写死：api_prefix 今天是空串
# （BASE_PATH 已经区分了项目，再套一层 /api 不带信息量），留着是为了需要时还能整体加回来。
router = APIRouter(prefix=f"{settings.api_prefix}/quiz_game", tags=["quiz_game"])

# 对应 Flask 的 ``request.get_json(silent=True) or {}``：没有 body / body 是 null 时
# 落到 None，路由里 ``payload or {}`` 补成空字典，后面的校验分支自然会回 400。
_JSON_BODY = Body(default=None)

# realtime 的 app 名。与 core.realtime.channel_of 拼频道用的第一段一致，
# 也和前端 EventSource 要连的 {BASE}/quiz_game/realtime 里那个 quiz_game 是同一个值。
_REALTIME_APP = "quiz_game"

MAX_TITLE = 255
MAX_QUESTIONS = 200
MAX_OPTIONS = 6
MIN_OPTIONS = 2


def _error(message, status_code=400, reason="invalid_request"):
    return json_response({"status": "error", "message": message, "reason": reason}, status_code)


def _handle_exception(exc):
    """把异常翻成响应。逐字照搬原 routes.py 的 _handle_exception。

    ★ 默认分支是 500 +「问答游戏服务错误」/ server_error，**不是** 400：
      非 QuizGameError 的异常都是我们自己的 bug，不该让前端以为是它参数传错了。
    ★ print 的前缀也照搬（原 routes.py 是「route error」、socket_events.py 是
      「socket error」）—— 入向事件现在也是路由，统一走这一条。
    """
    if isinstance(exc, service.QuizGameError):
        return _error(str(exc), exc.status_code, exc.reason)
    print("⚠️ Quiz game route error:", exc)
    return _error("问答游戏服务错误", 500, "server_error")


def _clean_text(value, limit):
    return " ".join(str(value or "").strip().split())[:limit]


def _clamp_question_time(raw):
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = service.DEFAULT_QUESTION_TIME
    return max(service.MIN_QUESTION_TIME, min(service.MAX_QUESTION_TIME, value))


def _sanitize_questions(raw_list):
    if not isinstance(raw_list, list):
        raise service.QuizGameError("题目格式不正确", 400, "invalid_questions")
    if len(raw_list) > MAX_QUESTIONS:
        raise service.QuizGameError(f"题目数量不能超过 {MAX_QUESTIONS}", 400, "too_many_questions")

    cleaned = []
    for idx, raw in enumerate(raw_list):
        if not isinstance(raw, dict):
            raise service.QuizGameError(f"第 {idx + 1} 题格式不正确", 400, "invalid_question")
        zh = str(raw.get("zh") or "").strip()
        if not zh:
            raise service.QuizGameError(f"第 {idx + 1} 题缺少题目文字", 400, "missing_question_text")

        raw_options = raw.get("options")
        if not isinstance(raw_options, list):
            raise service.QuizGameError(f"第 {idx + 1} 题选项格式不正确", 400, "invalid_options")
        options = []
        for opt in raw_options:
            if isinstance(opt, dict):
                opt_zh = str(opt.get("zh") or "").strip()
                opt_en = str(opt.get("en") or "").strip()
            else:
                opt_zh = str(opt or "").strip()
                opt_en = ""
            if opt_zh or opt_en:
                options.append({"zh": opt_zh, "en": opt_en})
        if len(options) < MIN_OPTIONS:
            raise service.QuizGameError(f"第 {idx + 1} 题至少需要 {MIN_OPTIONS} 个选项", 400, "too_few_options")
        if len(options) > MAX_OPTIONS:
            raise service.QuizGameError(f"第 {idx + 1} 题选项不能超过 {MAX_OPTIONS} 个", 400, "too_many_options")

        try:
            answer = int(raw.get("answer", 0))
        except (TypeError, ValueError):
            answer = 0
        if not (0 <= answer < len(options)):
            raise service.QuizGameError(f"第 {idx + 1} 题的正确答案超出范围", 400, "invalid_answer")

        cleaned.append(
            {
                "section": _clean_text(raw.get("section"), 255),
                "zh": zh,
                "en": str(raw.get("en") or "").strip(),
                "options": options,
                "answer": answer,
            }
        )
    return cleaned


# ─────────────────────── question-set CRUD ───────────────────────


@router.get("/sets")
@login_required
def list_sets():
    try:
        sets = QuizGameSet.query.order_by(QuizGameSet.position.asc(), QuizGameSet.id.asc()).all()
        return json_response({"status": "success", "sets": [s.to_dict() for s in sets]})
    except Exception as exc:
        return _handle_exception(exc)


@router.post("/sets")
@login_required
def create_set(payload: Optional[dict] = _JSON_BODY):
    try:
        payload = payload or {}
        title = _clean_text(payload.get("title"), MAX_TITLE)
        if not title:
            raise service.QuizGameError("请填写题库名称", 400, "missing_title")
        max_pos = db.session.query(db.func.max(QuizGameSet.position)).scalar() or 0
        quiz_set = QuizGameSet(
            title=title,
            description=str(payload.get("description") or "").strip() or None,
            question_time=_clamp_question_time(payload.get("question_time")),
            position=max_pos + 1,
            created_by_user_id=getattr(current_user, "id", None),
        )
        db.session.add(quiz_set)
        db.session.flush()
        if isinstance(payload.get("questions"), list):
            _replace_questions(quiz_set, payload["questions"])
        db.session.commit()
        return json_response({"status": "success", "set": quiz_set.to_dict(with_questions=True)})
    except Exception as exc:
        db.session.rollback()
        return _handle_exception(exc)


@router.get("/sets/{set_id:int}")
@login_required
def get_set(set_id: int):
    try:
        quiz_set = QuizGameSet.query.get(set_id)
        if not quiz_set:
            raise service.QuizGameError("题库不存在", 404, "set_not_found")
        return json_response({"status": "success", "set": quiz_set.to_dict(with_questions=True)})
    except Exception as exc:
        return _handle_exception(exc)


# 原来是一条 ``methods=["PUT", "PATCH"]``，用 api_route 一比一对应 ——
# 拆成两个函数就得维护两份函数体，迟早分叉。
@router.api_route("/sets/{set_id:int}", methods=["PUT", "PATCH"])
@login_required
def update_set(set_id: int, payload: Optional[dict] = _JSON_BODY):
    try:
        quiz_set = QuizGameSet.query.get(set_id)
        if not quiz_set:
            raise service.QuizGameError("题库不存在", 404, "set_not_found")
        payload = payload or {}
        # ★ 这里是 ``if "title" in payload``（字段在不在）而不是取值判真：
        #   传 ``{"title": ""}`` 要回 400「请填写题库名称」，不传则原样不动。
        if "title" in payload:
            title = _clean_text(payload.get("title"), MAX_TITLE)
            if not title:
                raise service.QuizGameError("请填写题库名称", 400, "missing_title")
            quiz_set.title = title
        if "description" in payload:
            quiz_set.description = str(payload.get("description") or "").strip() or None
        if "question_time" in payload:
            quiz_set.question_time = _clamp_question_time(payload.get("question_time"))
        if "is_archived" in payload:
            quiz_set.is_archived = bool(payload.get("is_archived"))
        if isinstance(payload.get("questions"), list):
            _replace_questions(quiz_set, payload["questions"])
        db.session.commit()
        return json_response({"status": "success", "set": quiz_set.to_dict(with_questions=True)})
    except Exception as exc:
        db.session.rollback()
        return _handle_exception(exc)


@router.delete("/sets/{set_id:int}")
@login_required
def delete_set(set_id: int):
    try:
        quiz_set = QuizGameSet.query.get(set_id)
        if not quiz_set:
            raise service.QuizGameError("题库不存在", 404, "set_not_found")
        db.session.delete(quiz_set)
        db.session.commit()
        return json_response({"status": "success"})
    except Exception as exc:
        db.session.rollback()
        return _handle_exception(exc)


@router.put("/sets/{set_id:int}/questions")
@login_required
def replace_questions(set_id: int, payload: Optional[dict] = _JSON_BODY):
    try:
        quiz_set = QuizGameSet.query.get(set_id)
        if not quiz_set:
            raise service.QuizGameError("题库不存在", 404, "set_not_found")
        payload = payload or {}
        # 这条**不**做 isinstance 判断：传 null / 不传 questions 会被下面的
        # ``raw_questions or []`` 兜成「清空题目」。与 update_set 的语义不同，是原样。
        _replace_questions(quiz_set, payload.get("questions"))
        db.session.commit()
        return json_response({"status": "success", "set": quiz_set.to_dict(with_questions=True)})
    except Exception as exc:
        db.session.rollback()
        return _handle_exception(exc)


def _replace_questions(quiz_set, raw_questions):
    cleaned = _sanitize_questions(raw_questions or [])
    QuizGameQuestion.query.filter_by(set_id=quiz_set.id).delete()
    for position, item in enumerate(cleaned):
        question = QuizGameQuestion(
            set_id=quiz_set.id,
            position=position,
            section=item["section"] or None,
            zh=item["zh"],
            en=item["en"] or None,
            answer=item["answer"],
        )
        question.options = item["options"]
        db.session.add(question)


# ─────────────────────── AI 出题助手 ───────────────────────


@router.post("/ai/generate")
@login_required
def ai_generate_questions(payload: Optional[dict] = _JSON_BODY):
    try:
        payload = payload or {}
        questions = ai.generate_questions(
            payload.get("prompt"),
            count=payload.get("count", 5),
            set_title=_clean_text(payload.get("set_title"), MAX_TITLE),
        )
        return json_response({"status": "success", "questions": questions})
    except ValueError as exc:
        # ⚠️ 顺序要紧：QuizGameError 是 ValueError 的子类，所以这条 except 会
        #   **先**接住它，把它的 status_code / reason 压成 400 / ai_error。
        #   ai.generate_questions 里抛的全是纯 ValueError，实际不会踩到，
        #   但顺序保持原样 —— 反过来写会改变「AI 未配置」这类错误的状态码。
        return _error(str(exc), 400, "ai_error")
    except Exception as exc:
        return _handle_exception(exc)


# ─────────────────────── live game session ───────────────────────


@router.post("/session")
@login_required
def create_game_session(payload: Optional[dict] = _JSON_BODY):
    try:
        payload = payload or {}
        set_id = payload.get("set_id")
        if not set_id:
            raise service.QuizGameError("请选择题库", 400, "missing_set_id")
        session = service.create_session(getattr(current_user, "id", None), int(set_id))
        return json_response(
            {
                "status": "success",
                "token": session["room_token"],
                "session": service.host_snapshot(session),
            }
        )
    except Exception as exc:
        return _handle_exception(exc)


@router.get("/session/{token}")
def get_game_session(token: str):
    """Public: lets a guest load the room title/status before joining.

    不挂 @login_required 是原样 —— 玩家页给未登录的现场观众用，token 本身就是凭证。
    """
    try:
        session = service.require_session(token)
        snap = service.base_meta(session)
        snap.update(
            {
                "player_count": len(service._load_players(session["room_token"])),
                "total_questions": len(session.get("questions") or []),
            }
        )
        return json_response({"status": "success", "session": snap})
    except Exception as exc:
        return _handle_exception(exc)


# ════════════ 入向动作：Socket.IO 事件 → POST 接口 ════════════
#
# 规则与事件对照见本文件顶部。下面每个函数都对应 socket_events.py 里的一个 handler，
# 函数体的语句顺序与原 handler 一一对应（含「先算快照再广播」这种顺序 ——
# base_meta 里有 server_now_ms，调换顺序会让两份载荷的时间戳差几毫秒）。


def _require_user():
    """逐字照搬 socket_events.py 的 _require_user。

    ★ 故意**不**用 core.auth.login_required：那个装饰器回的是另一套文案，
      而这里要的是「请先登录」/ unauthorized / 401 这三件套 —— 玩家页按 reason 分支。
    """
    if not getattr(current_user, "is_authenticated", False):
        raise service.QuizGameError("请先登录", 401, "unauthorized")


def _token_of(data):
    """``room_token`` 优先、``token`` 兜底 —— 原 handler 每一个都是这么取的。"""
    return service.normalize_token(data.get("room_token") or data.get("token"))


def _players_payload(token):
    """game:players 的载荷。三处（guest:join / host:kick / on_disconnect）共用，形状必须一致。"""
    return {"players": service.player_list(token), "player_count": len(service._load_players(token))}


def _broadcast_state(session, sender=None):
    """按 session 当前状态广播对应的转场事件，并把 (事件名, 载荷) 交还给调用方。

    原 socket_events.py 的 ``_broadcast_state`` 只广播、不返回；这里多返回一份，
    是为了让发起动作的那个人从 HTTP 响应里直接拿到结果（否则要等 SSE 绕一圈，手感发飘）。
    ★ 广播的和返回的是**同一个对象**，别拆成两次计算。
    """
    token = session["room_token"]
    status = session.get("status", "lobby")
    if status == "question":
        event = "game:question"
        data = {
            "question": service._public_question(session),
            "player_count": len(service._load_players(token)),
        }
    elif status == "reveal":
        answers = service._answers(token)
        event = "game:reveal"
        data = {
            "reveal": service._reveal_data(session, answers),
            "leaderboard": service.leaderboard(token),
        }
    elif status == "podium":
        event = "game:podium"
        data = {"leaderboard": service.leaderboard(token)}
    else:
        # 注意是 else 不是 ``elif status == "lobby"``：未知状态也回落到大厅，
        # 客户端永远收得到一个能渲染的画面。原样保留。
        event = "game:lobby"
        data = {"players": service.player_list(token)}
    # room_id 传裸 token：频道前缀由 realtime 自己拼，传 socket_room() 的返回值会拼重。
    publish_sync(_REALTIME_APP, token, event, data, sender=sender)
    return event, data


def _state_response(session, sender=None):
    event, data = _broadcast_state(session, sender)
    return json_response({"status": "success", "event": event, "data": data})


@router.post("/time/ping")
def quiz_game_time_ping(payload: Optional[dict] = _JSON_BODY):
    """对时。原 socket 事件 ``game:time:ping`` → ``game:time:pong``。

    客户端每 5 秒打一次，用 ``client_sent_at_ms`` 原样带回来估算自己与服务端的时钟差，
    界面上的倒计时按这个差值校正（题目载荷里的 ``endsAt`` 是**服务端**时间轴上的绝对毫秒）。

    ⚠️ 必须是 POST，不能做成 GET —— GET 会被浏览器/nginx 缓存，
      缓存住的 server_now_ms 会让所有人的偏移算错，倒计时集体跑偏。
    ⚠️ HTTP 的往返延迟比 WebSocket 大、抖动也更明显，对时精度会下降。可以接受的原因：
      作答是否超时由**服务端**判（record_answer 里比的是 now_ms()），
      客户端时钟只用来画进度条。
    """
    data = payload or {}
    return json_response(
        {
            "status": "success",
            "client_sent_at_ms": data.get("client_sent_at_ms"),
            "server_now_ms": service.now_ms(),
        }
    )


@router.post("/host/join")
def quiz_game_host_join(payload: Optional[dict] = _JSON_BODY):
    """主持台入场，拿一份 host 快照。原 socket 事件 ``game:host:join``。

    ★ **不挂 @login_required、也不调 _require_user()** —— 原 handler 就没有查登录，
      而 host 快照里带着每道题的正确答案。这个洞一直在，本次逐字保留（见文件顶部 ①）。
      别「顺手」加上：现有主持台页面会直接打不开。

    ``join_room(...)`` 去掉了 —— 订阅 GET {BASE}/quiz_game/realtime?room={token} 就是加入房间，
    首帧 host 快照由下面注册的 RealtimeApp.snapshot 回调推，和这条 POST 返回的是同一份。
    """
    data = payload or {}
    try:
        token = _token_of(data)
        session = service.require_session(token)
        # 原来是 emit("game:host", host_snapshot, to=request.sid)，只发给自己 → 就是响应体。
        return json_response({"status": "success", "session": service.host_snapshot(session)})
    except Exception as exc:
        return _handle_exception(exc)


@router.post("/guest/join")
def quiz_game_guest_join(payload: Optional[dict] = _JSON_BODY):
    """玩家入场。原 socket 事件 ``game:guest:join``。

    与原 handler 的对应：
      · ``add_player(..., sid=request.sid)`` 里的 sid 换成客户端上报的 ``connection_id``
        （SSE 的连接标识）。缺了它只是断线时清不掉在线标记，不影响入场本身，所以不强制。
      · ``emit("game:joined", {id, name}, to=sid)`` → 响应里的 ``joined``
      · ``emit("game:player", player_snapshot, to=sid)`` → 响应里的 ``session``
      · ``emit("game:players", {...}, to=room)`` → publish_sync（响应里也放一份 ``players``，
        这样带了 connection_id、会丢弃自己回声的客户端不会少收东西）

    幂等：add_player 是「存在就更新」（同一个 guest_id 重进只改名字和在线标记，
    分数和连对都留着），断线重连重发一次是安全的。
    """
    data = payload or {}
    try:
        token = _token_of(data)
        session, player = service.add_player(
            token,
            data.get("guest_id"),
            data.get("guest_name"),
            sid=data.get("connection_id") or None,
        )
        # ★ 顺序照搬原 handler：先算自己的两份，再算房间那份。
        joined = {"id": player["id"], "name": player["name"]}
        snapshot = service.player_snapshot(session, player)
        players = _players_payload(token)
        publish_sync(_REALTIME_APP, token, "game:players", players, sender=data.get("connection_id") or None)
        return json_response({"status": "success", "joined": joined, "session": snapshot, "players": players})
    except Exception as exc:
        return _handle_exception(exc)


@router.post("/host/start")
def quiz_game_host_start(payload: Optional[dict] = _JSON_BODY):
    """开始游戏（从第 0 题起）。原 socket 事件 ``game:host:start``。"""
    data = payload or {}
    try:
        _require_user()
        token = _token_of(data)
        session = service.start_question(token, 0)
        return _state_response(session, data.get("connection_id") or None)
    except Exception as exc:
        return _handle_exception(exc)


@router.post("/host/next")
def quiz_game_host_next(payload: Optional[dict] = _JSON_BODY):
    """下一题（翻过最后一题就是颁奖台）。原 socket 事件 ``game:host:next``。"""
    data = payload or {}
    try:
        _require_user()
        token = _token_of(data)
        session = service.next_question(token)
        return _state_response(session, data.get("connection_id") or None)
    except Exception as exc:
        return _handle_exception(exc)


@router.post("/host/reveal")
def quiz_game_host_reveal(payload: Optional[dict] = _JSON_BODY):
    """揭晓本题（算分 + 转场）。原 socket 事件 ``game:host:reveal``。

    ★ ``changed`` 为假时原 handler **什么都不广播**（状态不是 question，或者这题已经被
      「全员答完」自动揭晓过了 —— service.reveal 里的 SET NX 闸）。
      HTTP 版对应地回 ``event: null, data: null``，前端见 null 就当作「无事发生」，
      不要拿它去清空画面。
    """
    data = payload or {}
    try:
        _require_user()
        token = _token_of(data)
        session, changed = service.reveal(token)
        if not changed:
            return json_response({"status": "success", "event": None, "data": None})
        return _state_response(session, data.get("connection_id") or None)
    except Exception as exc:
        return _handle_exception(exc)


@router.post("/host/podium")
def quiz_game_host_podium(payload: Optional[dict] = _JSON_BODY):
    """直接跳颁奖台。原 socket 事件 ``game:host:podium``。"""
    data = payload or {}
    try:
        _require_user()
        token = _token_of(data)
        session = service.show_podium(token)
        return _state_response(session, data.get("connection_id") or None)
    except Exception as exc:
        return _handle_exception(exc)


@router.post("/host/reset")
def quiz_game_host_reset(payload: Optional[dict] = _JSON_BODY):
    """回到大厅，分数清零，人不清。原 socket 事件 ``game:host:reset``。"""
    data = payload or {}
    try:
        _require_user()
        token = _token_of(data)
        session = service.reset_game(token)
        return _state_response(session, data.get("connection_id") or None)
    except Exception as exc:
        return _handle_exception(exc)


@router.post("/host/kick")
def quiz_game_host_kick(payload: Optional[dict] = _JSON_BODY):
    """踢人。原 socket 事件 ``game:host:kick``。

    ★ 两处原样保留的怪脾气（见文件顶部 ②）：
      · ``guest_id`` 为空时**不踢人，但照样广播一次 game:players**；
      · 广播用的 ``player_list`` 不校验房间是否存在，房间过期时会广播一个空列表
        而不是回 404。只有 ``kick_player``（即 guest_id 非空那条路）才会 require_session。
    """
    data = payload or {}
    try:
        _require_user()
        token = _token_of(data)
        guest_id = str(data.get("guest_id") or "").strip()
        if guest_id:
            service.kick_player(token, guest_id)
        players = _players_payload(token)
        publish_sync(_REALTIME_APP, token, "game:players", players, sender=data.get("connection_id") or None)
        return json_response({"status": "success", **players})
    except Exception as exc:
        return _handle_exception(exc)


@router.post("/guest/answer")
def quiz_game_guest_answer(payload: Optional[dict] = _JSON_BODY):
    """作答。原 socket 事件 ``game:guest:answer``。

    ★ **不幂等**：它记一次作答（hsetnx，一人一次）。客户端不能自动重试 ——
      重试只会拿到 409 already_answered。Socket.IO 时代也没有重试，行为一致。

    响应体各键的出处：
      · ``choice``   ← 原 ``emit("game:answered", {"choice": …}, to=sid)``
      · ``progress`` ← 原 ``emit("game:progress", …, to=room)``（同时广播）
      · ``event`` / ``data`` ← 「全员都答完了」触发的自动揭晓转场（同时广播）；
        没触发时两个都是 null。

    ★ 错误分两档，都靠 ``reason`` 区分（见文件顶部的行为差异 ②）：
      already_answered / time_up / not_open 是**软拒绝**，原来走
      ``game:answer_rejected``，只提示一句；其余走通用错误。
    """
    data = payload or {}
    sender = data.get("connection_id") or None
    try:
        token = _token_of(data)
        # 原 handler 把 session 接下来就没再用过，这里用 _session 表明是刻意丢弃的。
        _session, choice, all_answered = service.record_answer(token, data.get("guest_id"), data.get("choice"))
        progress = {
            "answered_count": len(service._answers(token)),
            "online_count": service.online_count(token),
        }
        publish_sync(_REALTIME_APP, token, "game:progress", progress, sender=sender)
        event, state = None, None
        if all_answered:
            revealed, changed = service.reveal(token)
            if changed:
                event, state = _broadcast_state(revealed, sender)
        return json_response(
            {"status": "success", "choice": choice, "progress": progress, "event": event, "data": state}
        )
    except service.QuizGameError as exc:
        if exc.reason in ("already_answered", "time_up", "not_open"):
            # 对齐原 game:answer_rejected 的载荷形状 {reason, message}。
            return json_response({"status": "error", "reason": exc.reason, "message": str(exc)}, exc.status_code)
        return _handle_exception(exc)
    except Exception as exc:
        return _handle_exception(exc)


# ════════════ RealtimeApp：SSE 订阅端点 GET {BASE}/quiz_game/realtime?room={token} ════════════
#
# 注册了它，上面所有 publish_sync 推出去的消息才有人收得到。


def _realtime_authorize(room_id, user, params):
    """房间 token 本身就是凭证：6 位随机 + 12 小时 TTL。

    Socket.IO 时代也是「谁知道 token 谁就能 join_room」，主持人和玩家不做区分 ——
    ``game:host:join`` 本来就没查登录（见文件顶部 ①），这里跟着不查，
    否则现场观众（全都没登录）一个也订不上。
    """
    try:
        token = service.normalize_token(room_id)
    except service.QuizGameError:
        # ⚠️ 必须吞掉：authorize 里抛异常会变成 500，而非法 room_id 只是
        #    「这个房间不给订」，返回 False 让 realtime 静默剔除它。
        return False
    return service.get_session(token) is not None


def _realtime_snapshot(room_id, user, params):
    """首帧。带 ``?as={guest_id}`` 的是玩家，不带的是主持台。

    ★ 用 get_session 判空而不是直接 require_session：后者会抛 QuizGameError，
      而 snapshot 回调抛异常 = 整条 SSE 连接建不起来。房间刚好过期时
      应该是「没有首帧」（返回 None），不是 500。
    ★ guest_id 要用 service._clean_text(…, 80) 归一化后再查 players ——
      add_player 存进去的键就是这么归一化过的，直接拿原始串查会漏。
    ★ 查不到玩家（换了浏览器、被踢了）时 player 是 None，player_snapshot 对
      None 有完整的兜底分支（me / my_choice / reveal.me 全走空值），
      等价于原来「还没 guest:join 过」的状态，不必特殊处理。
    """
    session = service.get_session(room_id)
    if not session:
        return None
    guest_id = service._clean_text(params.get("as"), 80)
    if not guest_id:
        return service.host_snapshot(session)
    player = service._load_players(session["room_token"]).get(guest_id)
    return service.player_snapshot(session, player)


def _realtime_on_disconnect(conn):
    """断线清理。搬自 backend/app/socket_events.py 的 handle_disconnect 里 quiz_game 那一段。

    ``conn.id`` 顶替原来的 ``request.sid``（quizg:sid_map 那张 hash 的键，
    由 POST /guest/join 的 connection_id 写入）。

    ⚠️ 这只是**兜底**：SSE 的断开发现得比 Socket.IO 晚（要等下一次心跳写失败，
      手机锁屏最坏十几秒起步）。而且「在线人数」还被 record_answer 的
      「全员答完就自动揭晓」当分母用 —— 别把 player_count 当强一致的数看。
    正路是 players_key 上已有的 GAME_TTL_SECONDS（12 小时）自己过期。

    原代码把这一段包在 try/except 里 print 一行「⚠️ Quiz game presence cleanup error」，
    这里不用自己包：core.realtime._spawn_cleanup 已经 log.exception 兜住了整个回调，
    清理失败不会影响别的模块的清理（各模块各自一个回调）。
    """
    token = service.mark_offline_by_sid(conn.id)
    if not token:
        return
    publish_sync(_REALTIME_APP, token, "game:players", _players_payload(token))


register(
    RealtimeApp(
        name=_REALTIME_APP,
        authorize=_realtime_authorize,
        snapshot=_realtime_snapshot,
        # on_connect 故意留空：presence 的登记在 POST /guest/join 里做
        # （原来也是在 game:guest:join 事件里写 sid_map，connect 本身不登记任何人）。
        # 玩家的名字只有那个 POST 带着，连接本身给不出来。
        on_disconnect=_realtime_on_disconnect,
    )
)
