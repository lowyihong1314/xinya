from datetime import datetime

from sqlalchemy import UniqueConstraint, func

from models import db


class AssetWarehouse(db.Model):
    __tablename__ = "asset_warehouse"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(120), nullable=False, unique=True)
    code = db.Column(db.String(40), nullable=False, unique=True, index=True)
    location = db.Column(db.String(255), nullable=True)
    manager_user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    remark = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False,
        onupdate=func.now(),
    )

    manager = db.relationship("User", foreign_keys=[manager_user_id], lazy="joined")
    inventories = db.relationship(
        "AssetInventory",
        back_populates="warehouse",
        lazy="selectin",
        cascade="all, delete-orphan",
    )
    source_documents = db.relationship(
        "AssetStockDocument",
        back_populates="source_warehouse",
        foreign_keys="AssetStockDocument.source_warehouse_id",
        lazy="selectin",
    )
    target_documents = db.relationship(
        "AssetStockDocument",
        back_populates="target_warehouse",
        foreign_keys="AssetStockDocument.target_warehouse_id",
        lazy="selectin",
    )


class AssetItem(db.Model):
    __tablename__ = "asset_item"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(160), nullable=False)
    code = db.Column(db.String(40), nullable=False, unique=True, index=True)
    category = db.Column(db.String(80), nullable=True)
    unit = db.Column(db.String(30), nullable=False, default="件")
    status = db.Column(db.String(30), nullable=False, default="active", index=True)
    remark = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False,
        onupdate=func.now(),
    )

    sub_items = db.relationship(
        "AssetSubItem",
        back_populates="item",
        lazy="selectin",
        cascade="all, delete-orphan",
    )


class AssetSubItem(db.Model):
    __tablename__ = "asset_sub_item"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    item_id = db.Column(
        db.Integer,
        db.ForeignKey("asset_item.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    name = db.Column(db.String(160), nullable=False)
    sku = db.Column(db.String(60), nullable=True, unique=True, index=True)
    size = db.Column(db.String(30), nullable=True, index=True)
    color = db.Column(db.String(50), nullable=True)
    barcode = db.Column(db.String(120), nullable=True, unique=True, index=True)
    status = db.Column(db.String(30), nullable=False, default="active", index=True)
    remark = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False,
        onupdate=func.now(),
    )

    item = db.relationship("AssetItem", back_populates="sub_items", lazy="joined")
    inventories = db.relationship(
        "AssetInventory",
        back_populates="sub_item",
        lazy="selectin",
        cascade="all, delete-orphan",
    )
    document_lines = db.relationship(
        "AssetStockDocumentLine",
        back_populates="sub_item",
        lazy="selectin",
    )
    movements = db.relationship(
        "AssetStockMovement",
        back_populates="sub_item",
        lazy="selectin",
    )


class AssetInventory(db.Model):
    __tablename__ = "asset_inventory"
    __table_args__ = (
        UniqueConstraint("warehouse_id", "sub_item_id", name="uq_asset_inventory_warehouse_sub_item"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    warehouse_id = db.Column(
        db.Integer,
        db.ForeignKey("asset_warehouse.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    sub_item_id = db.Column(
        db.Integer,
        db.ForeignKey("asset_sub_item.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    quantity = db.Column(db.Integer, nullable=False, default=0)
    reserved_quantity = db.Column(db.Integer, nullable=False, default=0)
    min_quantity = db.Column(db.Integer, nullable=False, default=0)
    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False,
        onupdate=func.now(),
    )

    warehouse = db.relationship("AssetWarehouse", back_populates="inventories", lazy="joined")
    sub_item = db.relationship("AssetSubItem", back_populates="inventories", lazy="joined")


class AssetPartner(db.Model):
    __tablename__ = "asset_partner"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(160), nullable=False)
    code = db.Column(db.String(40), nullable=False, unique=True, index=True)
    partner_type = db.Column(db.String(30), nullable=False, default="both", index=True)
    contact_person = db.Column(db.String(120), nullable=True)
    phone = db.Column(db.String(60), nullable=True)
    address = db.Column(db.String(255), nullable=True)
    status = db.Column(db.String(30), nullable=False, default="active", index=True)
    remark = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False,
        onupdate=func.now(),
    )

    documents = db.relationship("AssetStockDocument", back_populates="counterparty", lazy="selectin")


class AssetStockDocument(db.Model):
    __tablename__ = "asset_stock_document"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    document_no = db.Column(db.String(50), nullable=False, unique=True, index=True)
    document_type = db.Column(db.String(40), nullable=False, index=True)
    status = db.Column(db.String(30), nullable=False, default="draft", index=True)
    source_warehouse_id = db.Column(
        db.Integer,
        db.ForeignKey("asset_warehouse.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    target_warehouse_id = db.Column(
        db.Integer,
        db.ForeignKey("asset_warehouse.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    requester_user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    handler_user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    taken_by_user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    taken_by_name = db.Column(db.String(120), nullable=True)
    destination_type = db.Column(db.String(30), nullable=True)
    destination_text = db.Column(db.String(255), nullable=True)
    counterparty_id = db.Column(
        db.Integer,
        db.ForeignKey("asset_partner.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    counterparty_name = db.Column(db.String(160), nullable=True)
    event_id = db.Column(
        db.Integer,
        db.ForeignKey("event_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    invoice_no = db.Column(db.String(80), nullable=True, index=True)
    invoice_type = db.Column(db.String(50), nullable=True)
    invoice_file_path = db.Column(db.String(255), nullable=True)
    reference_type = db.Column(db.String(50), nullable=True)
    reference_id = db.Column(db.Integer, nullable=True)
    # 销售单据 POST 到「收款审核」后的收款状态：None=未推送，process/checked/fail=收款审核状态。
    finance_payment_status = db.Column(db.String(20), nullable=True, index=True)
    note = db.Column(db.Text, nullable=True)
    created_by = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    approved_by = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    confirmed_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False,
        onupdate=func.now(),
    )

    source_warehouse = db.relationship(
        "AssetWarehouse",
        back_populates="source_documents",
        foreign_keys=[source_warehouse_id],
        lazy="joined",
    )
    target_warehouse = db.relationship(
        "AssetWarehouse",
        back_populates="target_documents",
        foreign_keys=[target_warehouse_id],
        lazy="joined",
    )
    requester = db.relationship("User", foreign_keys=[requester_user_id], lazy="joined")
    handler = db.relationship("User", foreign_keys=[handler_user_id], lazy="joined")
    taken_by_user = db.relationship("User", foreign_keys=[taken_by_user_id], lazy="joined")
    counterparty = db.relationship("AssetPartner", back_populates="documents", foreign_keys=[counterparty_id], lazy="joined")
    creator = db.relationship("User", foreign_keys=[created_by], lazy="joined")
    approver = db.relationship("User", foreign_keys=[approved_by], lazy="joined")
    event = db.relationship("EventData", foreign_keys=[event_id], lazy="joined")
    lines = db.relationship(
        "AssetStockDocumentLine",
        back_populates="document",
        lazy="selectin",
        cascade="all, delete-orphan",
    )
    movements = db.relationship(
        "AssetStockMovement",
        back_populates="document",
        lazy="selectin",
        cascade="all, delete-orphan",
    )


class AssetStockDocumentLine(db.Model):
    __tablename__ = "asset_stock_document_line"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    document_id = db.Column(
        db.Integer,
        db.ForeignKey("asset_stock_document.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    sub_item_id = db.Column(
        db.Integer,
        db.ForeignKey("asset_sub_item.id", ondelete="RESTRICT", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    quantity = db.Column(db.Integer, nullable=False)
    unit_cost = db.Column(db.Numeric(10, 2), nullable=True)
    unit_price = db.Column(db.Numeric(10, 2), nullable=True)
    line_amount = db.Column(db.Numeric(10, 2), nullable=True)
    remark = db.Column(db.String(255), nullable=True)

    document = db.relationship("AssetStockDocument", back_populates="lines", lazy="joined")
    sub_item = db.relationship("AssetSubItem", back_populates="document_lines", lazy="joined")
    movements = db.relationship(
        "AssetStockMovement",
        back_populates="document_line",
        lazy="selectin",
    )


class AssetStockMovement(db.Model):
    __tablename__ = "asset_stock_movement"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    document_id = db.Column(
        db.Integer,
        db.ForeignKey("asset_stock_document.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    document_line_id = db.Column(
        db.Integer,
        db.ForeignKey("asset_stock_document_line.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    warehouse_id = db.Column(
        db.Integer,
        db.ForeignKey("asset_warehouse.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    sub_item_id = db.Column(
        db.Integer,
        db.ForeignKey("asset_sub_item.id", ondelete="RESTRICT", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    movement_type = db.Column(db.String(40), nullable=False, index=True)
    quantity_delta = db.Column(db.Integer, nullable=False)
    quantity_before = db.Column(db.Integer, nullable=False)
    quantity_after = db.Column(db.Integer, nullable=False)
    taken_by_user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    destination_text = db.Column(db.String(255), nullable=True)
    invoice_no = db.Column(db.String(80), nullable=True)
    created_by = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    document = db.relationship("AssetStockDocument", back_populates="movements", lazy="joined")
    document_line = db.relationship("AssetStockDocumentLine", back_populates="movements", lazy="joined")
    warehouse = db.relationship("AssetWarehouse", foreign_keys=[warehouse_id], lazy="joined")
    sub_item = db.relationship("AssetSubItem", back_populates="movements", lazy="joined")
    taken_by_user = db.relationship("User", foreign_keys=[taken_by_user_id], lazy="joined")
    creator = db.relationship("User", foreign_keys=[created_by], lazy="joined")
