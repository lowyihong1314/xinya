from app.extensions import socketio


def emit_form_event(form_id, event, payload=None):
    room = f"wait_register_{form_id}"
    message = {"event": event, "room": room, "form_id": form_id}
    if payload:
        message.update(payload)
    socketio.emit("new_register", message, room=room)
