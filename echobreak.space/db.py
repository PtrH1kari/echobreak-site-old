import pymysql
from flask import g


def create_connection():
    return pymysql.connect(
        host="localhost",
        user="u3383175_ebdbu",
        password="8CGsxfuXUh0Y40wS",
        database="u3383175_ebdb",
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
        connect_timeout=5
    )


def get_db():
    if "db" not in g:
        g.db = create_connection()
    else:
        try:
            g.db.ping(reconnect=True)
        except:
            g.db = create_connection()

    return g.db


def close_db(e=None):
    db = g.pop("db", None)

    if db is not None:
        db.close()
