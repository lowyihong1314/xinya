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
