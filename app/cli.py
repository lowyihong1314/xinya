from flask import Flask

from models import get_shell_context


def register_cli(app: Flask) -> None:
    @app.shell_context_processor
    def shell_context():
        return get_shell_context()
