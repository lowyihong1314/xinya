from models import db


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
