from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RouteSpec:
    path: str
    methods: tuple[str, ...]


@dataclass(frozen=True)
class RouteGroup:
    name: str
    canonical: tuple[RouteSpec, ...]
    legacy: tuple[RouteSpec, ...] = ()


def route(path: str, *methods: str) -> RouteSpec:
    return RouteSpec(path=path, methods=tuple(methods))


FAHUI_ROUTE_GROUPS: tuple[RouteGroup, ...] = (
    RouteGroup(
        name="ylp_orders",
        canonical=(
            route("/api/fahui_router/orders/search", "GET"),
            route("/api/fahui_router/orders/<int:order_id>", "GET"),
            route("/api/fahui_router/orders/<int:order_id>/share-link", "POST"),
            route("/api/fahui_router/orders/shared", "GET"),
            route("/api/fahui_router/orders/by-phone", "GET"),
            route("/api/fahui_router/orders", "POST"),
            route("/api/fahui_router/versions", "GET"),
        ),
        legacy=(
            route("/api/fahui_router/search", "GET"),
            route("/api/fahui_router/get_order_by_id", "GET"),
            route("/api/fahui_router/get_orders_by_phone", "GET"),
            route("/api/fahui_router/new_customer", "POST"),
            route("/api/fahui_router/get_versions", "GET"),
        ),
    ),
    RouteGroup(
        name="fahui_payment_review",
        canonical=(
            route("/api/payment/review", "GET"),
            route("/api/payment/review/<int:payment_id>", "DELETE"),
            route("/api/payment/review/<int:payment_id>/approve", "POST"),
            route("/api/payment/review/<int:payment_id>/revoke", "POST"),
            route("/api/payment/payments/<int:payment_id>", "GET"),
            route("/api/payment/payments/<int:payment_id>/document", "GET"),
            route("/api/payment/payments/<int:payment_id>/status", "POST"),
        ),
        legacy=(
            route("/api/payment/payments", "GET"),
            route("/api/payment/get_all_payment_data", "GET"),
            route("/api/payment/get_payment_detail/<int:payment_id>", "GET"),
            route("/api/payment/get_payment_image/<int:payment_id>", "GET"),
            route("/api/payment/update_payment_status/<int:payment_id>", "POST"),
        ),
    ),
    RouteGroup(
        name="ylp_order_payments",
        canonical=(
            route("/api/payment/orders/<int:order_id>/payments", "GET", "POST"),
            route("/api/payment/orders/<int:order_id>/amount", "GET"),
            route("/api/payment/orders/<int:order_id>/quotation", "GET"),
            route("/api/payment/orders/<int:order_id>/receipt", "POST"),
            route("/api/payment/orders/<int:order_id>/receipt-image", "GET"),
        ),
        legacy=(
            route("/api/payment/get_payment_data/<int:order_id>", "GET"),
            route("/api/payment/make_payment/<int:order_id>", "POST"),
            route("/api/payment/calculate_amount/<int:order_id>", "GET"),
            route("/api/payment/download_quotation/<int:order_id>", "GET"),
            route("/api/payment/download_quotiton/<int:order_id>", "GET"),
            route("/api/payment/print_receipt/<int:order_id>", "POST"),
        ),
    ),
    RouteGroup(
        name="ylp_board",
        canonical=(
            route("/api/board_router/print-pdfs/<int:pdf_id>", "GET"),
            route("/api/board_router/boards/entries/<int:board_data_id>", "DELETE"),
            route("/api/board_router/boards", "GET"),
            route("/api/board_router/boards/entries/reorder", "POST"),
            route("/api/board_router/boards/entries", "POST"),
            route("/api/board_router/print-pdfs/clear", "POST"),
            route("/api/board_router/print-pdfs", "GET"),
            route("/api/board_router/versions", "GET"),
            route("/api/board_router/orders", "GET"),
            route("/api/board_router/orders/<int:order_id>/customer", "POST"),
            route("/api/board_router/orders/detail", "GET"),
            route("/api/board_router/orders/check-duplicate-owner-fields", "GET"),
            route("/api/board_router/orders/quick-search", "POST"),
            route("/api/board_router/orders/<int:order_id>/items", "POST"),
            route("/api/board_router/orders/<int:order_id>/items/<int:item_id>", "DELETE"),
            route("/api/board_router/orders/delete", "POST"),
            route("/api/board_router/orders/clone", "POST"),
            route("/api/board_router/orders/copy-to-current", "POST"),
            route("/api/board_router/item-form-values", "POST"),
            route("/api/board_router/print-pdfs/unattached", "GET"),
            route("/api/board_router/print-pdfs/unattached/clear", "POST"),
            route("/api/board_router/terminal-link", "POST"),
            route("/api/board_router/terminal/boards", "GET"),
            route("/api/board_router/terminal/highlight", "POST"),
        ),
        legacy=(
            route("/api/board_router/get_pdf_data/<int:pdf_id>", "GET"),
            route("/api/board_router/delete_board/<int:board_data_id>", "DELETE"),
            route("/api/board_router/list_all", "GET"),
            route("/api/board_router/insert_pdf", "POST"),
            route("/api/board_router/add_pdf", "POST"),
            route("/api/board_router/clear_print_pdf", "GET"),
            route("/api/board_router/get_all_print_data", "GET"),
            route("/api/board_router/get_version_list", "GET"),
            route("/api/board_router/get_orders_data", "GET"),
            route("/api/board_router/update_customer/<int:order_id>", "POST"),
            route("/api/board_router/get_order_detail", "GET"),
            route("/api/board_router/check_duplicate_owner_fields", "GET"),
            route("/api/board_router/fahui_search_emgine", "POST"),
            route("/api/board_router/add_paiwei/<int:order_id>", "POST"),
            route("/api/board_router/delete_item/<int:item_id>/<int:order_id>", "DELETE"),
            route("/api/board_router/delete_orders", "POST"),
            route("/api/board_router/copy_old_data", "POST"),
            route("/api/board_router/update_item_form_value", "POST"),
        ),
    ),
    RouteGroup(
        name="ylp_print",
        canonical=(
            route("/api/print_paiwei/config-page", "GET"),
            route("/api/print_paiwei/points", "GET", "POST"),
            route("/api/print_paiwei/app-download", "GET"),
            route("/api/print_paiwei/pdf-files", "GET"),
            route("/api/print_paiwei/pdf-file", "GET"),
            route("/api/print_paiwei/templates", "POST"),
            route("/api/print_paiwei/print-pdfs/<int:print_pdf_id>/preview-image", "GET"),
            route("/api/print_paiwei/preview/test", "POST"),
            route("/api/print_paiwei/orders/<int:order_id>/preview", "GET"),
            route("/api/print_paiwei/preview/by-orders", "POST"),
            route("/api/print_paiwei/files/<filename>", "GET"),
        ),
        legacy=(
            route("/api/print_paiwei/paiwei_config_page", "GET"),
            route("/api/print_paiwei/get_point_json", "GET"),
            route("/api/print_paiwei/update_point_json", "POST"),
            route("/api/print_paiwei/download_app", "GET"),
            route("/api/print_paiwei/get_all_pdf_name", "GET"),
            route("/api/print_paiwei/get_pdf_file", "GET"),
            route("/api/print_paiwei/upload_paiwei_template", "POST"),
            route("/api/print_paiwei/print_paiwei_order_item/<int:print_pdf_id>", "GET"),
            route("/api/print_paiwei/test_paiwei_image", "POST"),
            route("/api/print_paiwei/preview_order/<int:order_id>", "GET"),
            route("/api/print_paiwei/generate_by_orders", "POST"),
            route("/api/print_paiwei/download/<filename>", "GET"),
        ),
    ),
    RouteGroup(
        name="lamp_registration",
        canonical=(
            route("/api/lampRegistration_API/health", "GET"),
            route("/api/lampRegistration_API/registrations", "GET", "POST"),
            route("/api/lampRegistration_API/registrations/<int:registration_id>", "PATCH", "DELETE"),
            route("/api/lampRegistration_API/registrations/query", "POST"),
            route("/api/lampRegistration_API/payments/review", "GET"),
            route("/api/lampRegistration_API/payments", "POST"),
            route("/api/lampRegistration_API/payments/<int:payment_id>", "DELETE"),
            route("/api/lampRegistration_API/payments/<int:payment_id>/file", "GET"),
            route("/api/lampRegistration_API/payments/<int:payment_id>/approve", "POST"),
            route("/api/lampRegistration_API/payments/<int:payment_id>/revoke", "POST"),
        ),
        legacy=(
            route("/api/lampRegistration_API/ping", "GET"),
            route("/api/lampRegistration_API/register", "POST"),
            route("/api/lampRegistration_API/edit", "POST"),
            route("/api/lampRegistration_API/delete", "POST"),
            route("/api/lampRegistration_API/get_all_register", "GET"),
            route("/api/lampRegistration_API/get_all_register_by_payment", "GET"),
            route("/api/lampRegistration_API/get_by_ids", "POST"),
            route("/api/lampRegistration_API/make_payment", "POST"),
            route("/api/lampRegistration_API/remove_payment", "POST"),
            route("/api/lampRegistration_API/payment_file/<int:payment_id>", "GET"),
            route("/api/lampRegistration_API/approve_payment", "POST"),
            route("/api/lampRegistration_API/payments/approve", "POST"),
            route("/api/lampRegistration_API/payments/delete", "POST"),
            route("/api/lampRegistration_API/payments/revoke", "POST"),
        ),
    ),
)


@dataclass(frozen=True)
class AnonStatusCheck:
    name: str
    method: str
    path: str
    expected_status: int


FAHUI_ANON_STATUS_CHECKS: tuple[AnonStatusCheck, ...] = (
    AnonStatusCheck("lamp_health", "GET", "/api/lampRegistration_API/health", 200),
    AnonStatusCheck("ylp_versions", "GET", "/api/fahui_router/versions", 200),
    AnonStatusCheck("payment_review_requires_auth", "GET", "/api/payment/review", 401),
    AnonStatusCheck("lamp_review_requires_auth", "GET", "/api/lampRegistration_API/payments/review", 401),
    AnonStatusCheck("board_list_requires_auth", "GET", "/api/board_router/boards", 401),
    AnonStatusCheck("print_points_requires_auth", "GET", "/api/print_paiwei/points", 401),
)


__all__ = [
    "AnonStatusCheck",
    "FAHUI_ANON_STATUS_CHECKS",
    "FAHUI_ROUTE_GROUPS",
    "RouteGroup",
    "RouteSpec",
    "route",
]
