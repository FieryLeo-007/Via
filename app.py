import os
from pathlib import Path

from dotenv import dotenv_values, load_dotenv
from flask import Flask, render_template

from discovery.routes import bp as discovery_bp

ENV_FILE = Path(__file__).resolve().parent / ".env"
load_dotenv(ENV_FILE)

app = Flask(__name__)
app.register_blueprint(discovery_bp)

@app.route("/")
@app.route("/home.html")
def home():
    return render_template("home.html")


@app.route("/index.html")
def index():
    return render_template("index.html")


@app.route("/onboarding")
@app.route("/onboarding.html")
def onboarding():
    return render_template("onboarding.html")


@app.context_processor
def auth_config():
    # Only public browser credentials belong here. Never use a service-role key.
    # Resolve against this file, not the launch directory. Read on each render
    # so adding credentials does not require restarting the development server.
    local_config = dotenv_values(ENV_FILE)

    def setting(name):
        return (os.getenv(name) or local_config.get(name) or "").strip()

    return {"auth_config": {
        "url": setting("SUPABASE_URL").removesuffix("/").removesuffix("/rest/v1"),
        "key": setting("SUPABASE_PUBLISHABLE_KEY") or setting("SUPABASE_ANON_KEY"),
    }}

if __name__ == "__main__":
    app.run(debug=True)
