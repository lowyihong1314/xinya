"""转码任务的进程内状态表（原 backend/app/media/video_tasks.py，一行代码未改）。

``{video_id: {"pid", "source", "output", "start_time", "last_percent", "status"}}``，
由 service.async_compress_video 在后台线程里写、结束时 pop 掉。

★ 它是**每个进程一份**的普通字典，不是共享状态：gunicorn 4 个 worker 就有 4 张表，
  A worker 起的转码在 B worker 里查不到。Flask 时代（gunicorn 多 worker）就是这样，
  没有退化 —— 真正跨进程的那份状态是磁盘上的 ``<output>.lock`` 文件
  （里面有 pid，别的 worker 靠 psutil.pid_exists 判断"还在转"）。
  所以这张表目前只被 async_compress_video 自己读写，**没有任何路由读它**；
  想做"转码任务列表"接口的话，要去读 lock 文件而不是读这张表。
"""

current_video_tasks = {}
