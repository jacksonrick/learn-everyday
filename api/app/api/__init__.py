from . import admin, auth, client


def register_blueprints(app):
    app.register_blueprint(client.bp, url_prefix="/api/v1/client")
    app.register_blueprint(auth.bp, url_prefix="/api/v1/admin")
    app.register_blueprint(admin.bp, url_prefix="/api/v1/admin")
