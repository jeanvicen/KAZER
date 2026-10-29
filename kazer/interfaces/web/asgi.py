"""Entrada ASGI para hospedagem (Vercel e afins): `kazer.interfaces.web.asgi:app`."""

from kazer.interfaces.web.app import create_app

app = create_app()
