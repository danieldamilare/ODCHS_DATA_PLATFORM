from gevent import monkey

monkey.patch_all()

try:
    from psycogreen.gevent import patch_psycopg

    patch_psycopg()
except ImportError:
    pass

from app import app as app
from app import app as app
