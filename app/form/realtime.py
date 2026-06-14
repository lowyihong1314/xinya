from app.extensions import socket_broker


YOUTH_CLASS_REGISTRATION_ROOM = "youth_class_registration"


def emit_form_event(form_id, event, payload=None):
    room = f"wait_register_{form_id}"
    message = {"event": event, "room": room, "form_id": form_id}
    if payload:
        message.update(payload)
    socket_broker.emit("new_register", message, room=room)


def emit_youth_class_event(event, payload=None):
    message = {
        "event": event,
        "room": YOUTH_CLASS_REGISTRATION_ROOM,
    }
    if payload:
        message.update(payload)
    try:
        socket_broker.emit(
            "youth_class_registration_update",
            message,
            room=YOUTH_CLASS_REGISTRATION_ROOM,
        )
    except Exception as exc:
        print(f"[WS-DISCONNECTED] Youth class emit skipped: {exc}")
