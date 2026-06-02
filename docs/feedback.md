# 用户反馈整理

这份文件用于记录目前发现的 Bug 和功能需求。  
优先级说明：

- **P0：** 会影响正常使用，建议优先处理
- **P1：** 常用流程需要补强
- **P2：** 体验优化或后续增强

---

## 开发 Checklist

建议先做 P0 和低风险前端改动，再做 Finance 需要接口 / 数据库变更的部分。

### 本轮处理状态

- [x] 播放队列：加入歌曲不会再中断当前播放。
- [x] `/event/157` 图片：已补无扩展名图片兼容，`album_files.id=17686` 可生成 cache 预览。
- [x] MOD 文件：已加入媒体上传和视频识别范围。
- [x] 活动类型：已加入 `佛曲分享会` 固定选项，同时保留手动输入其他类型。
- [x] 活动附件：CRM 活动管理已支持一次多选上传。
- [x] Finance 筛选：Claim 列表已支持全部 / 已批准 / 未批准。
- [x] Finance 附件：Claim 详情已支持后续补上传多个附件。
- [x] Finance 编辑：`account_edit` 可编辑申请人、金额、日期、部门、用途。
- [x] Album 年份：Album 首页已支持年份下拉选择。
- [x] Claim 金额上限：按要求暂时不处理。
- [x] Claim 给别人：Claim 详情已显示 Payment Voucher 收款人 / 签收时间，并支持补上传凭证附件。
- [x] Claim 编辑留痕：新增修改记录，能看到谁在什么时候改了哪些字段。

### 1. 播放队列：加入歌曲不应中断当前播放

可能要改：

- `frontend/src/music/music_player/logic/MusicPlaybackContext.tsx`
- `frontend/src/music/music_player/logic/useMusicWorkspace.ts`
- 如 APK 也复现，再看 `frontend/android/app/src/main/java/com/utba/app/NativeMusicPlugin.java`

Checklist：

- [ ] 修改 `appendToQueue`，有当前播放歌曲时只追加队列，不改 `currentMusicId`。
- [ ] 有当前播放歌曲时，不触发 `autoplayKey`，避免播放器重新加载音频。
- [ ] 没有当前歌曲时，允许把新加入歌曲设为当前歌曲。
- [ ] 保留现有 toast：`已加入播放队列`。
- [ ] 手动测试：播放 A 时加入 B，A 继续播，B 进入队列尾部。
- [ ] 手动测试：没有播放任何歌曲时加入 B，队列和播放器状态正常。

### 2. `/event/157` 图片无法显示

可能要查：

- `app/media/services.py`
- `app/media/routes.py`
- `frontend/src/components/CacheMediaPlayer.tsx`
- `frontend/src/album/react/EventDetailPage.tsx`
- 数据库 `event_data` / `album_files` 中 event 157 的图片记录
- 实际文件：`DATA_ROOT/NAS/UTBA/event_photo/<event_code>/...`

Checklist：

- [ ] 查 event 157 的 `event_image` / `album_files` 指向哪一个 file id。
- [ ] 确认数据库文件名和实际磁盘文件是否一致。
- [ ] 确认 `/media/get_event_image/<file_id>/cache` 和 `/media/get_event_image/<file_id>/base` 返回内容。
- [ ] 如果是 DB 指向不存在文件，修复记录或重新指定活动封面。
- [ ] 如果是文件类型未支持，补上对应的 preview / fallback 逻辑。
- [ ] 打开 `/event/157` 验证详情页和 album 首页都能正常显示。

### 3. MOD 文件上传

可能要改：

- `app/media/constants.py`
- `app/media/services.py`
- `frontend/src/album/react/UploadMediaModal.tsx`
- `frontend/src/album/react/ImageDetailPage.tsx`
- `frontend/src/album/react/HomeAlbumPage.tsx`

Checklist：

- [ ] 在 `ALLOWED_EXTENSIONS` 加 `.mod`。
- [ ] 在 `VIDEO_EXTS` 加 `.mod`，让后台把它当视频处理。
- [ ] 在 `UploadMediaModal.tsx` 的 `ACCEPTED_EXTENSIONS` 加 `mod`。
- [ ] 在 `ImageDetailPage.tsx` 的 `VIDEO_EXTENSIONS` 加 `mod`。
- [ ] 调整 `app/media/services.py` 的 `get_event_type_payload`，让 `.mod` 返回视频类型。
- [ ] 检查 `HomeAlbumPage.tsx` 里只判断 `mp4` / `mov` 的地方，避免 MOD 预览被当成图片处理。
- [ ] 上传一个 MOD 文件，验证上传成功、详情页可打开、转码或原文件打开逻辑正常。

### 4. 活动类型新增“佛曲分享会”

可能要改：

- `frontend/src/CRM/event/react/useEventTableController.ts`
- `frontend/src/CRM/event/react/EventTableView.tsx`
- `frontend/src/album/react/EditEventModal.tsx`

Checklist：

- [ ] 把 `佛曲分享会` 加入活动类型的固定选项。
- [ ] 新建活动时，类型字段可以直接选择 `佛曲分享会`。
- [ ] 编辑活动时，类型字段可以直接选择 `佛曲分享会`。
- [ ] 活动列表筛选中即使还没有旧记录，也能看到 `佛曲分享会` 选项。
- [ ] 确认不需要数据库 migration，因为 `event_data.type` 已经是字符串字段。

### 5. 活动附件上传支持一次多选

可能要改：

- `frontend/src/CRM/event/react/EventTableView.tsx`
- `frontend/src/CRM/event/react/EventTablePage.tsx`
- `frontend/src/CRM/event/react/useEventTableController.ts`
- `frontend/src/CRM/event/react/api.ts`
- 后台可先复用现有单文件接口：`POST /api/event_data/event_file/upload/<event_id>`

Checklist：

- [ ] 活动附件 input 加 `multiple`。
- [ ] `onUploadAttachment` 从单个 `File` 改成可以处理 `File[]`。
- [ ] Controller 逐个调用 `uploadEventFile`。
- [ ] 上传完成后只刷新一次活动资料。
- [ ] 部分文件失败时显示失败数量，不影响成功文件。
- [ ] 手动测试一次选择 2 个以上文件，活动附件列表全部出现。

### 6. Finance 列表增加批准 / 未批准筛选

可能要改：

- `frontend/src/CRM/Account/react/claim/ClaimWorkspace.tsx`
- `frontend/src/CRM/Account/react/claim/ClaimList.tsx`
- `frontend/src/CRM/Account/react/claim/ClaimDetail.tsx`

Checklist：

- [x] 定义筛选值：`全部`、`已批准`、`未批准`。
- [x] 先确认规则：`未批准` 包含 `pending + rejected`。
- [x] 在 `ClaimWorkspace.tsx` 先按状态筛选，再分页。
- [x] 在 `ClaimList.tsx` 增加筛选 UI。
- [x] 搜索关键词和状态筛选需要可以同时生效。
- [x] 切换筛选时重置到第 1 页。

### 7. Finance record 后续补上传附件

现有情况：

- 新建 claim 时已经支持 `files` 多附件。
- 后台已有 `ReimbursementAttachment` model。
- 详情页已经能显示附件。

可能要改：

- `app/account/routes.py`
- `app/account/services.py`
- `app/account/serializers.py`
- `frontend/src/CRM/Account/react/claim/api.ts`
- `frontend/src/CRM/Account/react/claim/ClaimDetail.tsx`

Checklist：

- [x] 从 `create_claim_from_form` 抽出共用的附件保存 helper。
- [x] 新增接口：给指定 claim 追加附件。
- [x] 权限规则：申请人本人或 `account_edit` 可在未锁定时追加附件。
- [x] Claim 详情页增加“新增附件”按钮和文件 input。
- [x] 支持一次选择多个附件。
- [x] 上传成功后刷新当前 claim。
- [x] 如要删除附件，再新增删除附件接口和按钮。

### 8. Finance 批准人可以编辑申请内容

可能要改：

- `models/finance.py`
- 新增 migration
- `app/account/routes.py`
- `app/account/services.py`
- `app/account/serializers.py`
- `frontend/src/CRM/Account/react/claim/api.ts`
- `frontend/src/CRM/Account/react/claim/ClaimDetail.tsx`

Checklist：

- [x] 确认可编辑字段：金额、日期、部门、用途、关联活动、附件。
- [x] 新增 `PUT /api/account/claim/<id>` 或类似接口。
- [x] 只有 `account_edit` 可以编辑别人提交的 claim。
- [x] 已锁定 `is_locked` 的 claim 不允许编辑。
- [x] 编辑后保留审批状态，除非之后决定要重新提交。
- [x] 增加修改记录，至少记录：谁改、什么时候改、改了哪些字段。
- [x] 前端详情页增加编辑模式。
- [x] 修改金额后，详情页、列表、Payment Voucher 都显示新金额。

### 9. Claim 金额上限规则确认（暂不处理）

目前初步检查：

- 代码里暂时没有明显的 `500` claim amount 上限。
- 现在更像是权限问题：普通账号可能没有 `account_submit_claim`，财政账号有相关权限。

需要确认后再改：

- [ ] 暂不处理，按用户要求先跳过。

### 10. Album 首页年份改成下拉选择

可能要改：

- `frontend/src/album/react/HomeAlbumPage.tsx`
- 如需要事件年份数据，再看 `frontend/src/event/shared/EventDataContext.tsx`

Checklist：

- [x] 把中间的 `{year} / {month}` 改成可操作控件。
- [x] 年份使用 `<select>`，可直接选 2024、2025、2026 等。
- [x] 年份选项从活动年份 + 当前年份生成，避免年份列表太短。
- [x] 保留左右月份切换按钮。
- [x] 切换年份后保持当前月份。
- [x] 手机端 toolbar 不要挤压或换行混乱。

### 11. Claim 给别人 / 付款凭证更清楚

现有情况：

- Payment Voucher 已有 `voucher_recipient_name`、签名和下载流程。
- Claim 本身已有附件。

Checklist：

- [x] 确认“claim 给别人”先按收款人 / 签收人处理。
- [x] 如果是收款人，优先复用 Payment Voucher recipient 字段。
- [ ] 如果是代提交对象，需要新增字段，例如 `claim_target_name`。
- [x] 在详情页清楚显示：申请人、收款人、附件凭证。
- [x] Payment Voucher 下载时包含收款人和附件资料。
- [x] 后续查账不需要再翻聊天记录确认。

### 建议验证命令

- [x] `npm run build`，确认前端 TypeScript / Vite build 通过。
- [x] `python3 -m py_compile app/account/services.py app/account/routes.py app/media/services.py app/media/constants.py`，确认后端语法通过。
- [x] 如果有 migration，执行 migration 生成和本地 upgrade。
- [ ] 手动跑关键页面：Music、`/event/157`、活动管理、Album 首页、Finance Claim。

---

## P0：Bug

### 1. 播放队列：加入歌曲后当前播放被中断

**问题：**  
目前在播放歌曲时，如果把新歌曲加入队列，当前正在播放的歌曲会被停止，并且播放状态会跳回队列第一首。

**期望：**

- 加入队列时，不应该中断当前正在播放的歌曲。
- 当前歌曲继续播放。
- 新加入的歌曲只进入队列，等轮到它时才播放。

**验收标准：**

- 播放 A 歌曲时，加入 B 歌曲到队列，A 不会停止。
- 队列顺序正确。
- 播放状态不会自动跳回第一首。

---

### 2. 活动图片：`/event/157` 有图片无法显示

**问题：**  
在活动 `/event/157` 中，有一个已上传的 image 无法正常显示。

**期望：**

- 已上传的图片可以正常显示。
- 如果图片文件不存在、路径错误或格式不支持，页面需要有明确处理方式。

**验收标准：**

- `/event/157` 的图片可以正常打开和预览。
- 图片路径、文件存储和前端显示逻辑一致。

---

### 3. 文件上传：MOD 文件无法上传

**问题：**  
目前 MOD file 上传不了。

**期望：**

- 系统应支持上传 MOD 文件，或明确提示不支持的原因。
- 如果是文件类型限制，需要把 MOD 加入允许上传的类型。

**验收标准：**

- 选择 MOD 文件后可以成功上传。
- 上传失败时，用户可以看到明确错误信息。

---

## P1：功能需求

### 4. 活动类型：新增“佛曲分享会”

**需求：**  
活动类型需要新增一个选项：**佛曲分享会**。

**验收标准：**

- 新建活动时可以选择“佛曲分享会”。
- 编辑活动时可以选择“佛曲分享会”。
- 活动列表、筛选、详情页都能正确显示这个活动类型。

---

### 5. 活动附件：上传时支持多选

**需求：**  
活动附件上传时，需要可以一次选择多个文件。

**期望：**

- 用户可以在文件选择窗口中一次选多个附件。
- 系统逐个上传并显示上传结果。
- 部分文件失败时，不影响其他文件上传。

**验收标准：**

- 一次选择多个附件后，所有成功上传的文件都会出现在活动附件列表。
- 上传失败的文件有明确提示。

---

### 6. 财务记录：增加审批状态筛选

**需求：**  
Finance 页面需要增加筛选功能，可以按审批状态筛选记录。

**筛选项：**

- 全部
- 已批准
- 未批准

**验收标准：**

- 可以快速查看已批准的记录。
- 可以快速查看未批准的记录。
- 筛选后列表和统计数据保持一致。

---

### 7. 财务记录：每条记录支持附件

**需求：**  
每一条 finance record 需要可以新增 attachment，用来上传 claim 凭证、付款证明或其他相关资料。

**期望：**

- 每条记录可以上传至少一个附件。
- 附件可以在记录详情中查看。
- 如有需要，后续可以扩展为一条记录多个附件。

**验收标准：**

- 新增 claim 时可以上传附件。
- 记录创建后也可以补上传附件。
- 附件可以正常查看或下载。

---

### 8. 财务审批：批准人可以编辑申请内容

**需求：**  
如果申请人填写错误，批准人需要可以直接手动调整内容，不一定要 reject 后再让申请人重新提交。

**可编辑内容建议：**

- 金额
- 分类
- 备注
- 附件
- Claim 对象或相关人

**验收标准：**

- 有权限的批准人可以编辑申请内容。
- 编辑后保留修改记录，知道是谁改了什么。
- 编辑后不需要申请人重新提交，除非批准人主动退回。

---

### 9. 财务 Claim 金额上限：确认不同身份的限制

**问题：**  
目前一般学长姐身份 claim 500 块无法提交，只能用财政身份提交。需要确认系统是否有针对不同身份设置 claim amount 上限。

**需要确认：**

- 不同角色是否有不同 claim 金额上限。
- 一般学长姐的 claim 上限是多少。
- 财政身份是否可以绕过金额上限。
- 超过上限时，应该禁止提交还是进入额外审批流程。

**验收标准：**

- Claim 金额上限规则清楚显示或写入后台配置。
- 用户超过上限时，可以看到明确提示。
- 财政或管理员角色的权限规则明确。

---

### 10. Album 页面：年份选择改成下拉

**位置：**  
`frontend/src/album/react/HomeAlbumPage.tsx`

**问题：**  
目前选择月份和年份时，年份切换不方便。要查看 2024 年活动时，需要跳很多次。

**需求：**

- 年份改成可以点击选择的下拉菜单。
- 月份保留现有选择方式也可以，但年份必须更容易切换。

**验收标准：**

- 用户可以直接选择 2024、2025、2026 等年份。
- 不需要连续点击很多次才能切换到旧年份。
- 年份切换后，月份和活动列表显示正确。

---

## P2：体验优化

### 11. 财务附件：Claim 给别人的凭证需要更清楚

**需求：**  
如果 claim 是帮别人处理或已经把钱 claim 给别人，需要可以上传相关凭证，并在记录上看得出来这笔 claim 的对象和凭证。

**建议补充字段：**

- Claim 对象
- 付款 / 转账凭证
- 处理备注

**验收标准：**

- 财务人员可以清楚看到这笔 claim 是谁申请、谁收款、凭证是什么。
- 后续查账时不需要再翻聊天记录确认。
