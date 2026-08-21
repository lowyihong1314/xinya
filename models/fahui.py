from datetime import datetime

from models import db


# 多条订单 ↔ 单条付款记录（一次付款可覆盖多张 YLP 订单）。
fahui_payment_order = db.Table(
    "fahui_payment_order",
    db.Column(
        "payment_id",
        db.Integer,
        db.ForeignKey("payment_data.id", ondelete="CASCADE"),
        nullable=False,
    ),
    db.Column(
        "order_id",
        db.Integer,
        db.ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
    ),
)


class FahuiVersion(db.Model):
    __tablename__ = "versions"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    version = db.Column(db.String(50), nullable=False)


class FahuiRawDoc(db.Model):
    """法会手写单据原图（DATA_ROOT/fahui_raw_img/images 下的一张图）。

    一张单据可以录成多张订单（一页写了好几笔、或一叠单据拆单），所以
    raw_doc 1 → N order，走 fahui_raw_doc_order 关联表。
    """

    __tablename__ = "fahui_raw_doc"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    filename = db.Column(db.String(255), nullable=False, unique=True, index=True)
    # 归档时的来源目录（法会 / jiayee_fahui_project）
    source = db.Column(db.String(64), nullable=True)
    shot_date = db.Column(db.Date, nullable=True, index=True)
    file_size = db.Column(db.Integer, nullable=True)
    sha256 = db.Column(db.String(64), nullable=True, index=True)

    # AI 抽取档（extracted/photoNNN.json）里读到的资料
    extract_key = db.Column(db.String(32), nullable=True, index=True)
    customer_name = db.Column(db.String(160), nullable=True)
    phone = db.Column(db.String(64), nullable=True, index=True)
    declared_total = db.Column(db.Numeric(10, 2), nullable=True)
    review_flag_count = db.Column(db.Integer, nullable=True)
    plan = db.Column(db.Text, nullable=True)
    # 内容完全相同的另一张图（sha256 撞上），只留说明用
    duplicate_of = db.Column(db.String(255), nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    links = db.relationship(
        "FahuiRawDocOrder",
        back_populates="raw_doc",
        lazy="selectin",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    flags = db.relationship(
        "FahuiRawDocFlag",
        back_populates="raw_doc",
        lazy="selectin",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="FahuiRawDocFlag.seq, FahuiRawDocFlag.id",
    )

    def to_dict(self, include_links=True):
        data = {
            "id": self.id,
            "filename": self.filename,
            "source": self.source,
            "date": self.shot_date.isoformat() if self.shot_date else None,
            "size": self.file_size,
            "extract": self.extract_key,
            "customer": self.customer_name,
            "phone": self.phone,
            "declared_total": float(self.declared_total) if self.declared_total is not None else None,
            "review_flags": self.review_flag_count,
            "plan": self.plan,
            "duplicate_of": self.duplicate_of,
        }
        if include_links:
            data["orders"] = [link.to_dict() for link in (self.links or [])]
            flags = [flag.to_dict() for flag in (self.flags or [])]
            data["flags"] = flags
            data["flags_open"] = sum(1 for flag in flags if not flag["resolved"])
        return data


class FahuiRawDocFlag(db.Model):
    """抽取档里的 review_flags：AI 读单时留下的「这处要人工确认」备注，可逐条勾选已处理。"""

    __tablename__ = "fahui_raw_doc_flag"
    __table_args__ = (
        db.UniqueConstraint("raw_doc_id", "text_hash", name="uq_fahui_raw_doc_flag"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    raw_doc_id = db.Column(
        db.Integer,
        db.ForeignKey("fahui_raw_doc.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    # 原始顺序（抽取档里第几条）
    seq = db.Column(db.Integer, nullable=False, default=0)
    text = db.Column(db.Text, nullable=False)
    # 文本指纹：重新扫描时靠它认出同一条备注，保住「已处理」状态
    text_hash = db.Column(db.String(40), nullable=False)
    resolved = db.Column(db.Boolean, nullable=False, default=False)
    resolved_at = db.Column(db.DateTime, nullable=True)
    resolved_by_user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    raw_doc = db.relationship("FahuiRawDoc", back_populates="flags")
    resolved_by = db.relationship("User", lazy="joined")

    def to_dict(self):
        return {
            "id": self.id,
            "seq": self.seq,
            "text": self.text,
            "resolved": bool(self.resolved),
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
            "resolved_by": (
                getattr(self.resolved_by, "display_name", None)
                or getattr(self.resolved_by, "username", None)
            ),
        }


class FahuiRawDocOrder(db.Model):
    """原始文档 ↔ 订单 的关联（一张图可挂多张订单）。"""

    __tablename__ = "fahui_raw_doc_order"
    __table_args__ = (
        db.UniqueConstraint("raw_doc_id", "order_id", name="uq_fahui_raw_doc_order"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    raw_doc_id = db.Column(
        db.Integer,
        db.ForeignKey("fahui_raw_doc.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    order_id = db.Column(
        db.Integer,
        db.ForeignKey("orders.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    # 怎么对上的：phone_name_total / phone_total / phone_name / phone_only / manual
    match_by = db.Column(db.String(32), nullable=True)
    # high / medium / low / manual
    confidence = db.Column(db.String(16), nullable=True)
    note = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    raw_doc = db.relationship("FahuiRawDoc", back_populates="links")
    order = db.relationship("FahuiOrder", lazy="joined")

    def to_dict(self):
        order = self.order
        items = list(getattr(order, "items", None) or [])
        return {
            "order_id": self.order_id,
            "match_by": self.match_by,
            "confidence": self.confidence,
            "note": self.note,
            "version": getattr(order, "version", None),
            "customer_name": getattr(order, "customer_name", None) or getattr(order, "name", None),
            "status": getattr(order, "status", None),
            "phone": getattr(order, "phone", None),
            # 审核用：订单实际金额与笔数，拿去和单据上申报的对比
            "item_count": len(items),
            "order_total": round(sum(float(item.price or 0) for item in items), 2),
        }


class FahuiVersionEvent(db.Model):
    """法会版本 ↔ 活动绑定：把某个版本（例：2026_YLP）挂到活动上，
    该版本的订单/付款就会作为收入行出现在活动预算里（做法同报名表格收入）。"""

    __tablename__ = "fahui_version_event"
    __table_args__ = (
        db.UniqueConstraint("workspace", "version", name="uq_fahui_version_event"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    # ylp / lamp，目前只接了 ylp，留着以后灯会也能绑
    workspace = db.Column(db.String(16), nullable=False, default="ylp", index=True)
    version = db.Column(db.String(50), nullable=False, index=True)
    event_id = db.Column(
        db.Integer,
        db.ForeignKey("event_data.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    created_by_user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL"),
        nullable=True,
    )

    event = db.relationship(
        "EventData",
        backref=db.backref("fahui_version_bindings", lazy="selectin", cascade="all, delete-orphan", passive_deletes=True),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "workspace": self.workspace,
            "version": self.version,
            "event_id": self.event_id,
            "event_name": getattr(self.event, "event_name", None),
            "event_datetime": self.event.datetime.isoformat() if getattr(self.event, "datetime", None) else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class FahuiOrder(db.Model):
    __tablename__ = "orders"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    status = db.Column(db.String(50), nullable=True)
    date = db.Column(db.Date, nullable=True)
    time = db.Column(db.Time, nullable=True)
    name = db.Column(db.String(100), nullable=True)
    email = db.Column(db.String(100), nullable=True)
    customer_name = db.Column(db.String(100), nullable=True)
    member_name = db.Column(db.String(100), nullable=True)
    # 最后创建/维护这张订单的登录用户（CRM 或已登录的公众端）；匿名操作保持不变。
    user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    phone = db.Column(db.String(20), nullable=True)
    code = db.Column(db.String(50), nullable=True)
    full_code = db.Column(db.String(100), nullable=True)
    created_at = db.Column(
        db.TIMESTAMP,
        nullable=True,
        server_default=db.text("current_timestamp()"),
    )
    version = db.Column(
        db.String(50),
        nullable=False,
        server_default=db.text("'2024_YLP'"),
    )

    maintainer = db.relationship("User", lazy="selectin")
    items = db.relationship(
        "FahuiOrderItem",
        back_populates="order",
        lazy="selectin",
        passive_deletes=True,
    )
    payments = db.relationship(
        "FahuiPayment",
        back_populates="order",
        lazy="selectin",
        passive_deletes=True,
    )
    # 通过 join 表关联的「合并付款」（一条付款覆盖多张订单）
    grouped_payments = db.relationship(
        "FahuiPayment",
        secondary="fahui_payment_order",
        back_populates="grouped_orders",
        lazy="selectin",
    )


class FahuiOrderItem(db.Model):
    __tablename__ = "order_items"
    __table_args__ = (
        db.Index("order_id", "order_id"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    order_id = db.Column(
        db.Integer,
        db.ForeignKey(
            "orders.id",
            name="fk_order_id",
            ondelete="CASCADE",
            onupdate="CASCADE",
        ),
        nullable=True,
    )
    code = db.Column(db.String(20), nullable=True)
    item_name = db.Column(db.String(100), nullable=True)
    price = db.Column(db.Numeric(10, 2), nullable=True)
    line_id = db.Column(db.String(100), nullable=True)

    order = db.relationship("FahuiOrder", back_populates="items", lazy="joined")
    form_data = db.relationship(
        "FahuiItemFormData",
        back_populates="item",
        lazy="selectin",
        passive_deletes=True,
    )
    pdf_pages = db.relationship(
        "FahuiPdfPageData",
        back_populates="order_item",
        lazy="selectin",
        passive_deletes=True,
    )


class FahuiItemFormData(db.Model):
    __tablename__ = "item_form_data"
    __table_args__ = (
        db.Index("item_id", "item_id"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    item_id = db.Column(
        db.Integer,
        db.ForeignKey(
            "order_items.id",
            name="fk_item_id",
            ondelete="CASCADE",
            onupdate="CASCADE",
        ),
        nullable=True,
    )
    field_name = db.Column(db.String(100), nullable=True)
    field_value = db.Column(db.Text, nullable=True)

    item = db.relationship("FahuiOrderItem", back_populates="form_data", lazy="joined")


class FahuiPayment(db.Model):
    __tablename__ = "payment_data"
    __table_args__ = (
        db.Index("order_id", "order_id"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    created_at = db.Column(
        db.DateTime,
        nullable=False,
        server_default=db.text("current_timestamp()"),
    )
    order_id = db.Column(
        db.Integer,
        db.ForeignKey("orders.id", name="payment_data_ibfk_1", ondelete="CASCADE"),
        nullable=True,
    )
    payment_type = db.Column(
        "type",
        db.String(20),
        nullable=False,
        index=True,
        server_default=db.text("'ylp'"),
    )
    total_price = db.Column(db.Numeric(10, 2), nullable=False)
    status = db.Column(
        db.String(50),
        nullable=True,
        server_default=db.text("'pending'"),
    )
    payment_mode = db.Column(db.String(50), nullable=True)
    submitter_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    valid_by = db.Column(db.String(100), nullable=True)
    valid_at = db.Column(db.DateTime, nullable=True)
    payer_name = db.Column(db.String(200), nullable=True)
    phone = db.Column(db.String(50), nullable=True)
    paid_at = db.Column(db.DateTime, nullable=True)
    note = db.Column(db.Text, nullable=True)
    document = db.Column(db.String(500), nullable=True)

    order = db.relationship("FahuiOrder", back_populates="payments", lazy="joined")
    submitter = db.relationship(
        "User",
        backref=db.backref("fahui_payments", lazy="dynamic"),
        lazy="joined",
    )
    lamp_registrations = db.relationship(
        "LampRegistration",
        secondary="lamp_payment_registration",
        back_populates="payments",
        lazy="selectin",
    )
    # 一条付款覆盖的多张 YLP 订单
    grouped_orders = db.relationship(
        "FahuiOrder",
        secondary="fahui_payment_order",
        back_populates="grouped_payments",
        lazy="selectin",
    )


FahuiPaymentData = FahuiPayment


class FahuiPrintPdf(db.Model):
    __tablename__ = "print_pdf"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    created_at = db.Column(
        db.DateTime,
        nullable=False,
        server_default=db.text("current_timestamp()"),
    )
    width = db.Column(db.Integer, nullable=True)
    height = db.Column(db.Integer, nullable=True)

    pages = db.relationship(
        "FahuiPdfPageData",
        back_populates="print_pdf",
        lazy="selectin",
        passive_deletes=True,
    )
    board_entries = db.relationship(
        "FahuiBoardData",
        back_populates="print_pdf",
        lazy="selectin",
        passive_deletes=True,
    )


class FahuiPdfPageData(db.Model):
    __tablename__ = "pdf_page_data"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    print_pdf_id = db.Column(
        db.Integer,
        db.ForeignKey("print_pdf.id", name="fk_page_printpdf", ondelete="CASCADE"),
        nullable=False,
    )
    order_item_id = db.Column(
        db.Integer,
        db.ForeignKey("order_items.id", name="fk_page_orderitem", ondelete="CASCADE"),
        nullable=False,
    )

    print_pdf = db.relationship("FahuiPrintPdf", back_populates="pages", lazy="joined")
    order_item = db.relationship("FahuiOrderItem", back_populates="pdf_pages", lazy="joined")


class FahuiBoardHeader(db.Model):
    __tablename__ = "board_header"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    board_name = db.Column(db.String(255), nullable=False)
    board_width = db.Column(db.Integer, nullable=True)
    board_height = db.Column(db.Integer, nullable=True)
    version = db.Column(db.String(50), nullable=True, index=True)

    board_entries = db.relationship(
        "FahuiBoardData",
        back_populates="board",
        lazy="selectin",
        passive_deletes=True,
    )


class FahuiBoardData(db.Model):
    __tablename__ = "board_data"
    __table_args__ = (
        db.Index("idx_board_id", "board_id"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    board_id = db.Column(
        db.Integer,
        db.ForeignKey("board_header.id", name="fk_board_data_header", ondelete="CASCADE"),
        nullable=False,
    )
    print_pdf_id = db.Column(
        db.Integer,
        db.ForeignKey(
            "print_pdf.id",
            name="fk_board_data_print_pdf",
            ondelete="SET NULL",
            onupdate="CASCADE",
        ),
        nullable=True,
    )
    location = db.Column(db.Integer, nullable=True)
    created_at = db.Column(
        db.DateTime,
        nullable=False,
        server_default=db.text("current_timestamp()"),
    )

    board = db.relationship("FahuiBoardHeader", back_populates="board_entries", lazy="joined")
    print_pdf = db.relationship("FahuiPrintPdf", back_populates="board_entries", lazy="joined")


class FahuiPaymentChannel(db.Model):
    __tablename__ = "fahui_payment_channel"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    version = db.Column(db.String(50), nullable=False, index=True)
    channel_type = db.Column(db.String(20), nullable=False)  # "qr" | "bank"
    label = db.Column(db.String(120), nullable=True)
    qr_image_path = db.Column(db.String(255), nullable=True)
    bank_name = db.Column(db.String(120), nullable=True)
    bank_account_no = db.Column(db.String(120), nullable=True)
    bank_account_name = db.Column(db.String(120), nullable=True)
    note = db.Column(db.String(255), nullable=True)
    sort_order = db.Column(db.Integer, nullable=False, default=0)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(
        db.TIMESTAMP,
        nullable=True,
        server_default=db.text("current_timestamp()"),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "version": self.version,
            "channel_type": self.channel_type,
            "label": self.label,
            "qr_image_path": self.qr_image_path,
            "bank_name": self.bank_name,
            "bank_account_no": self.bank_account_no,
            "bank_account_name": self.bank_account_name,
            "note": self.note,
            "sort_order": self.sort_order,
            "is_active": bool(self.is_active),
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class FahuiRelationOption(db.Model):
    __tablename__ = "fahui_relation_option"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    label = db.Column(db.String(100), nullable=False, unique=True)
    sort_order = db.Column(db.Integer, nullable=False, default=0)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(
        db.TIMESTAMP,
        nullable=True,
        server_default=db.text("current_timestamp()"),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "label": self.label,
            "sort_order": self.sort_order,
            "is_active": bool(self.is_active),
        }


class FahuiOpenWindow(db.Model):
    """法会报名开放时间段（每年循环，按月-日匹配，如 07-01 至 09-01）。"""

    __tablename__ = "fahui_open_window"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    # 法会标识：ylp（盂兰盆牌位）/ lamp（点灯）
    fahui_key = db.Column(db.String(32), nullable=False, index=True)
    # 每年开放起止（含当天），格式 MM-DD；start > end 表示跨年（如 12-15 至 01-15）
    start_md = db.Column(db.String(5), nullable=False)
    end_md = db.Column(db.String(5), nullable=False)
    note = db.Column(db.String(255), nullable=True)
    created_at = db.Column(
        db.TIMESTAMP,
        nullable=True,
        server_default=db.text("current_timestamp()"),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "fahui_key": self.fahui_key,
            "start_md": self.start_md,
            "end_md": self.end_md,
            "note": self.note,
        }
