from flask import Flask, render_template
from auth import auth
from fanfics import fanfics_bp
from db import close_db
import os


application = Flask(
    __name__,
    static_folder=os.path.join(os.getcwd(), 'static'),
    static_url_path='/static'
)

application.secret_key = 'e6ade675f0117aa4da827eef10737587'

application.register_blueprint(auth)
application.register_blueprint(fanfics_bp)
application.teardown_appcontext(close_db)


@application.route('/')
@application.route('/<path:path>')
def index(path=None):
    return render_template('index.html')


@application.route('/page/<name>')
def page(name):
    try:
        return render_template(f'pages/{name}.html')
    except Exception:
        return 'Страница не найдена', 404


@application.route('/test')
def test():
    return 'OK'


if __name__ == '__main__':
    application.run(debug=True)
